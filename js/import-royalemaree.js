/**************************************************
 * IMPORT ROYALE MAREE (10004)
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * 🔍 Recherche AF_MAP — tolère les zéros supprimés
 **************************************************/
function findAFMapEntry(afMap, fourCode, refFournisseur) {
  if (!refFournisseur) return null;
  const refStr = refFournisseur.toString().trim();
  const keyExact = `${fourCode}__${refStr}`.toUpperCase();
  const keyNoZero = `${fourCode}__${refStr.replace(/^0+/, "")}`.toUpperCase();
  const keyAlt = `${fourCode}__${refStr.padStart(5, "0")}`.toUpperCase();
  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyAlt] || null;
}

/**************************************************
 * 🧩 FAO normalisé
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  zone = zone.toUpperCase().replace(/^FAO/, "FAO ").replace(/\s+/g, " ").trim();
  sousZone = sousZone?.toUpperCase().replace(/\./g, "").trim() || "";
  if (zone.startsWith("ÉLE")) return zone;
  if (zone.startsWith("FAO")) return `${zone}${sousZone ? " " + sousZone : ""}`.trim();
  return `${zone} ${sousZone}`.trim().replace(/\s{2,}/g, " ");
}

/**************************************************
 * PDF TEXT EXTRACT
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib)
    throw new Error("PDF.js non chargé. Ajoute <script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'>");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str);
    fullText += strings.join(" ") + "\n";
  }
  return fullText;
}

/**************************************************
 * PARSE LINES
 **************************************************/
function parseRoyaleMareeLines(text) {
  const rows = [];

  // Nettoyage
  let clean = text
    .replace(/\s+/g, " ")
    .replace(/€/g, "")
    .replace(/\(pour Facture\)/gi, "")
    .replace(/\s*Page\s*\d+\/\d+\s*/gi, " ")
    .replace(/Transp\..+?Départ\s*:/gi, " ")
    .trim();

  // Chaque article: code (4-5) + 6 nombres (colis, poidsColis, montant, prixKg, poidsTotal) + désignation
  // Un article = code (4-5 chiffres) suivi d’au moins 5 valeurs numériques (colis, poids, montant, prix, poidsT…)
const parts = clean.split(/(?=\b\d{4,5}\s+\d+(?:[\s,]+\d+|\s+[\d,]+){4,6}\s*[A-Z])/g);

  console.log("📦 Nombre de blocs trouvés :", parts.length);


  for (let part of parts) {
    const head = part.match(
      /(\d{4,5})\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([A-Z0-9éèàç+\/\-\s]+)/i
    );
    if (!head) continue;

    const [
      _,
      refFourn,
      colis,
      poidsColis,
      montant,
      prixKg,
      poidsTotal,
      designation
    ] = head;

    // Suite après l’en-tête: contient (ligne nom latin) puis bloc traçabilité avec "|"
    const tail = part.slice(head.index + head[0].length);

    // 🔹 Nom latin: 2–3 mots (Camel ou lower), + option suffixe code (ex: "SAL") avant le premier "|"
    // exemples valides: "Gadus morhua", "Gadus Morhua", "Salmo salar SAL"
    const nomLatinMatch = tail.match(
      /([A-Z][a-z]+(?:\s+[A-Za-z]+){1,2}(?:\s+[A-Z]{2,5})?)\s*(?=\|Pêché|\|Elevé|$)/i
    );
    const nomLatin = nomLatinMatch ? nomLatinMatch[1].trim() : "";

    // 🔹 Bloc traçabilité (de |Pêché … / |Elevé … jusqu'au prochain code article ou fin)
    const blocTrace = tail.match(/\|\s*(Pêché|Elevé).+?(?=\d{4,5}\s+\d+\s+[\d,]+|$)/i);
    const traceTxt = blocTrace ? blocTrace[0] : "";

    let zone = "";
    let sousZone = "";
    let engin = "";
    let lot = "";
    let fao = "";

    // 🔸 FAO (dernier FAO du bloc si plusieurs)
    const allFAO = [...traceTxt.matchAll(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/gi)];
    if (allFAO.length) {
      const last = allFAO[allFAO.length - 1];
      zone = `FAO27`.replace(/27$/, last[1]); // au cas où
      sousZone = last[2] ? last[2].toUpperCase().replace(/\./g, "") : "";
    }

    // 🔸 ÉLEVAGE (ex: "Elevé en : zone Eleve en Ecosse")
    if (/Elevé/i.test(traceTxt)) {
      zone = "ÉLEVAGE";
      // on prend la ligne "Elevé en : ..." et on capture le dernier mot comme pays/région
      const elevLine = traceTxt.match(/Elevé\s+en\s*:?\s*([^|]+)/i);
      if (elevLine) {
        // nettoie les mots parasites ("zone", "Eleve en") et prend le dernier mot significatif
        const tokens = elevLine[1]
          .replace(/\b(zone|éleve|eleve|en)\b/gi, " ")
          .trim()
          .split(/\s+/);
        const lastWord = tokens.length ? tokens[tokens.length - 1] : "";
        if (lastWord) sousZone = lastWord.toUpperCase();
      }
    }

    // 🔸 Engin
    const mEngin = traceTxt.match(/Engin\s*:\s*([^|]+)/i);
    if (mEngin) engin = mEngin[1].trim();

    // 🔸 Lot
    const mLot = traceTxt.match(/Lot\s*:\s*(\S+)/i);
    if (mLot) lot = mLot[1].trim();

    // 🔸 Normalisation FAO final
    if (zone.startsWith("ÉLE")) {
      fao = sousZone ? `ÉLEVAGE ${sousZone}` : "ÉLEVAGE";
    } else if (zone.toUpperCase().startsWith("FAO")) {
      // variantes "FAO27" ou "FAO 27"
      const z = zone.replace(/^FAO\s*/, "FAO").replace(/^FAO(\d+)/, "FAO $1");
      fao = `${z}${sousZone ? " " + sousZone : ""}`.trim();
    }

    // 🔸 Nettoyage "ZONE" parasite
    if (/^ZONE/i.test(sousZone)) sousZone = sousZone.replace(/^ZONE\s*/i, "").trim();

    rows.push({
      refFournisseur: refFourn.trim(),
      designation: (designation.trim() + (nomLatin ? " " + nomLatin : "")).trim(),
      nomLatin,
      colis: parseInt(colis),
      poidsColisKg: parseFloat(poidsColis.replace(",", ".")),
      poidsTotalKg: parseFloat(poidsTotal.replace(",", ".")),
      prixKg: parseFloat(prixKg.replace(",", ".")),
      montantHT: parseFloat(montant.replace(",", ".")),
      zone,
      sousZone,
      engin,
      lot,
      fao
    });
  }

  console.log("🧾 Lignes extraites:", rows);
  return rows;
}

/**************************************************
 * FIRESTORE SAVE (avec mapping AF_MAP + Articles)
 **************************************************/
async function saveRoyaleMaree(lines) {
  if (!lines.length) throw new Error("Aucune ligne trouvée dans le PDF.");

  const FOUR_CODE = "10004";
  const supplier = { code: FOUR_CODE, nom: "Royale Marée" };

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => { afMap[d.id.toUpperCase()] = d.data(); });

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a.plu) artMap[a.plu.toString().trim()] = a;
  });

  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code,
    fournisseurNom: supplier.nom,
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const achatId = achatRef.id;

  let totalHT = 0, totalKg = 0;
  const missingRefs = [];

  for (const L of lines) {
    totalHT += L.montantHT;
    totalKg += L.poidsTotalKg;

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;

    if (M) {
      plu = (M.plu || "").toString().trim();
      if (plu.endsWith(".0")) plu = plu.slice(0, -2);
      designationInterne = M.designationInterne || designationInterne;
      allergenes = M.allergenes || "";
      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = M.engin;
    } else {
      missingRefs.push(L.refFournisseur);
    }

    // 🔹 Complète depuis la fiche Article si PLU connu
    const art = artMap[plu];
    if (art) {
      if (!designationInterne || designationInterne.length < 3)
        designationInterne = art.designation || designationInterne;
      if (!zone && art.zone) zone = art.zone;
      if (!sousZone && art.sousZone) sousZone = art.sousZone;
      if (!engin && art.engin) engin = art.engin;
    }

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu,
      designationInterne,
      allergenes,
      fao: buildFAO(zone, sousZone),
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp(),
  });

  if (missingRefs.length > 0)
    console.warn("⚠️ Références non trouvées dans AF_MAP:", missingRefs);

  alert(`✅ ${lines.length} lignes importées pour Royale Marée`);
}

/**************************************************
 * MAIN ENTRY
 **************************************************/
export async function importRoyaleMaree(file) {
  const text = await extractTextFromPdf(file);
  console.log("🔍 PDF brut (début):", text.slice(0, 1000));
  const lines = parseRoyaleMareeLines(text);
  console.log("✅ Lignes détectées:", lines);
  await saveRoyaleMaree(lines);
}
