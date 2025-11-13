/**************************************************
 * IMPORT ROYALE MAREE (10004)
 * Fichier prêt à coller dans /scripts/import-royale-maree.js
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * 🔎 Recherche AF_MAP — tolère zéros supprimés
 **************************************************/
function findAFMapEntry(afMap, fourCode, refFournisseur) {
  if (!refFournisseur) return null;
  const refStr = refFournisseur.toString().trim();
  const keyExact  = `${fourCode}__${refStr}`.toUpperCase();
  const keyNoZero = `${fourCode}__${refStr.replace(/^0+/, "")}`.toUpperCase();
  const keyPad    = `${fourCode}__${refStr.padStart(5, "0")}`.toUpperCase();
  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPad] || null;
}

/**************************************************
 * 🧩 FAO normalisé (y compris élevage)
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  const isElev = zone.normalize("NFD").replace(/\p{Diacritic}/gu,"").toUpperCase().startsWith("ELEV");
  if (isElev) return ("ÉLEVAGE" + (sousZone ? " " + sousZone.toUpperCase() : "")).trim();

  // FAO num + sous-zone romaine
  let z = zone.toUpperCase().replace(/^FAO\s*/, "FAO").replace(/^FAO(\d+)/, "FAO $1").trim();
  let sz = (sousZone || "").toUpperCase().replace(/\./g, "").trim();
  return (z + (sz ? " " + sz : "")).trim().replace(/\s{2,}/g, " ");
}

/**************************************************
 * PDF TEXT EXTRACT — conserve des "lignes"
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) {
    throw new Error(
      "PDF.js non chargé. Ajoute <script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'> dans la page."
    );
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // ⚠️ IMPORTANT: on garde un \n entre chaque item pour pouvoir parser "ligne par ligne"
    const strings = content.items.map(i => i.str);
    fullText += strings.join("\n") + "\n";
  }
  console.log("🔍 PDF brut (aperçu avec \\n):", fullText.slice(0, 1000));
  return fullText;
}

/**************************************************
 * PARSE SÉQUENTIEL (robuste)
 **************************************************/
function parseRoyaleMareeLines(text) {
  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0);

  let current = null;

  for (let raw of lines) {
    // 🟢 Début d'un nouvel article : code 4–5 chiffres + 6 nombres + désignation
    if (/^\d{4,5}\s+\d+\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+[\d,]+/.test(raw)) {
      // push le précédent si existant
      if (current) rows.push(current);

      const parts = raw.match(
        /^(\d{4,5})\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*(.+)$/i
      );
      if (!parts) { current = null; continue; }

      current = {
        refFournisseur: parts[1].trim(),
        colis: parseInt(parts[2]),
        poidsColisKg: parseFloat(parts[3].replace(",", ".")),
        montantHT: parseFloat(parts[4].replace(",", ".")),
        prixKg: parseFloat(parts[5].replace(",", ".")),
        poidsTotalKg: parseFloat(parts[6].replace(",", ".")),
        designation: (parts[7] || "").trim(),
        nomLatin: "",
        zone: "",
        sousZone: "",
        engin: "",
        lot: "",
        fao: ""
      };
      continue;
    }

    if (!current) continue;

    // 🔹 Nom latin (2–3 mots + éventuel code suffixe) avant tout bloc "|"
    if (!raw.startsWith("|") && /^[A-Z][a-z]+/.test(raw)) {
      // Exemples: "Gadus morhua", "Gadus Morhua", "Salmo salar SAL", "Lophius piscatorius MON"
      const latin = raw.match(/^([A-Z][a-z]+(?:\s+[A-Za-z]+){1,2}(?:\s+[A-Z]{2,5})?)$/i);
      if (latin) {
        current.nomLatin = latin[1].trim();
        // On ajoute le nom latin en suffixe lisible (évite doublons si déjà présent)
        if (!current.designation.toLowerCase().includes(current.nomLatin.toLowerCase())) {
          current.designation = (current.designation + " " + current.nomLatin).trim();
        }
        continue;
      }
    }

    // 🔹 Bloc traçabilité
    if (raw.startsWith("|")) {
      // FAO + Pêché/Elevé
      if (/Pêché/i.test(raw) || /FAO/i.test(raw) || /Elevé/i.test(raw)) {
        // Cas FAO (prend le dernier FAO)
        const allFAO = [...raw.matchAll(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/gi)];
        if (allFAO.length) {
          const last = allFAO[allFAO.length - 1];
          current.zone = `FAO${last[1]}`;
          current.sousZone = last[2] ? last[2].toUpperCase().replace(/\./g, "") : "";
          current.fao = buildFAO(current.zone, current.sousZone);
        }

        // Cas Élevage "Elevé en : zone Eleve en Ecosse"
        if (/Elevé/i.test(raw)) {
          current.zone = "ÉLEVAGE";
          const elevLine = raw.match(/Elevé.+?en\s*:?\s*([^|]+)/i);
          if (elevLine) {
            const tokens = elevLine[1]
              .replace(/\b(zone|éleve|eleve|en)\b/gi, " ")
              .trim()
              .split(/\s+/);
            const lastWord = tokens.length ? tokens[tokens.length - 1] : "";
            current.sousZone = lastWord ? lastWord.toUpperCase() : "";
          }
          current.fao = buildFAO(current.zone, current.sousZone);
        }
      }

      // Engin
      if (/Engin/i.test(raw)) {
        const m = raw.match(/Engin\s*:\s*([^|]+)/i);
        if (m) current.engin = m[1].trim();
      }

      // Lot
      if (/Lot/i.test(raw)) {
        const m = raw.match(/Lot\s*:\s*([A-Za-z0-9\-]+)/i);
        if (m) current.lot = m[1].trim();
      }
    }
  }

  // Dernier bloc
  if (current) rows.push(current);

  console.log("📦 Nombre d'articles trouvés:", rows.length);
  console.log("🧾 Lignes extraites:", rows);
  return rows;
}

/**************************************************
 * FIRESTORE SAVE (AF_MAP + Articles)
 **************************************************/
async function saveRoyaleMaree(lines) {
  if (!lines.length) throw new Error("Aucune ligne trouvée dans le PDF.");

  const FOUR_CODE = "10004";
  const supplier = { code: FOUR_CODE, nom: "Royale Marée" };

  // Charge AF_MAP + Articles une seule fois
  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => { afMap[d.id.toUpperCase()] = d.data(); });

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString().trim()] = a;
  });

  // Crée l'en-tête achat
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

  let totalHT = 0;
  let totalKg = 0;
  const missingRefs = [];

  for (const L of lines) {
    totalHT += Number(L.montantHT || 0);
    totalKg  += Number(L.poidsTotalKg || 0);

    // Mapping AF_MAP
    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao; // déjà construit par le parseur

    if (M) {
      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");
      designationInterne = M.designationInterne || designationInterne;
      allergenes = M.allergenes || "";
      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = M.engin;
      if (!fao) fao = buildFAO(zone, sousZone);
    } else {
      missingRefs.push(L.refFournisseur);
    }

    // Enrichissement Article si PLU trouvé
    const art = plu ? artMap[plu] : null;
    if (art) {
      if (!designationInterne || designationInterne.length < 3)
        designationInterne = art.designation || designationInterne;
      if (!zone && art.zone) zone = art.zone;
      if (!sousZone && art.sousZone) sousZone = art.sousZone;
      if (!engin && art.engin) engin = art.engin;
      if (!fao) fao = buildFAO(zone, sousZone);
    }

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      // Données PDF normalisées
      refFournisseur: L.refFournisseur,
      designation: L.designation,
      nomLatin: L.nomLatin,
      colis: L.colis,
      poidsColisKg: L.poidsColisKg,
      poidsTotalKg: L.poidsTotalKg,
      prixKg: L.prixKg,
      montantHT: L.montantHT,
      zone,
      sousZone,
      engin,
      lot: L.lot || "",
      fao,

      // Enrichissements
      plu,
      designationInterne,
      allergenes,

      // Métadonnées d'achat
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: Number(totalHT.toFixed(2)),
    montantTTC: Number(totalHT.toFixed(2)),
    totalKg: Number(totalKg.toFixed(3)),
    updatedAt: serverTimestamp(),
  });

  if (missingRefs.length > 0) {
    console.warn("⚠️ Références non trouvées dans AF_MAP:", missingRefs);
  }

  alert(`✅ ${lines.length} lignes importées pour Royale Marée`);
}

/**************************************************
 * MAIN ENTRY
 **************************************************/
export async function importRoyaleMaree(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseRoyaleMareeLines(text);
  await saveRoyaleMaree(lines);
}
