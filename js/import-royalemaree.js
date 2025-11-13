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
 * PDF TEXT EXTRACT — version avec vraies lignes
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib)
    throw new Error(
      "PDF.js non chargé. Ajoute <script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'>"
    );
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // 👉 on remet un saut de ligne après chaque item, pour conserver la structure
    const strings = content.items.map(i => i.str);
    fullText += strings.join("\n") + "\n";
  }

  console.log("🔍 PDF brut (avec \\n) aperçu:", fullText.slice(0, 1000));
  return fullText;
}


/**************************************************
 * PARSE LINES
 **************************************************/
function parseRoyaleMareeLines(text) {
  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0);

  let current = null;

  for (let raw of lines) {
    // 🟢 Nouvelle ligne article (code 4–5 chiffres au début)
    if (/^\d{4,5}\s+\d+\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+[\d,]+/.test(raw)) {
      // Sauvegarde l’article précédent s’il existe
      if (current) rows.push(current);

      const parts = raw.match(
        /^(\d{4,5})\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*(.+)$/i
      );
      if (!parts) continue;

      current = {
        refFournisseur: parts[1],
        colis: parseInt(parts[2]),
        poidsColisKg: parseFloat(parts[3].replace(",", ".")),
        montantHT: parseFloat(parts[4].replace(",", ".")),
        prixKg: parseFloat(parts[5].replace(",", ".")),
        poidsTotalKg: parseFloat(parts[6].replace(",", ".")),
        designation: parts[7].trim(),
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

    // 🔹 Nom latin = 2–3 mots (ex : "Gadus morhua", "Salmo salar SAL")
    if (/^[A-Z][a-z]+/.test(raw) && !raw.startsWith("|")) {
      current.nomLatin = raw.trim();
      current.designation += " " + current.nomLatin;
      continue;
    }

    // 🔹 Bloc traçabilité
    if (raw.startsWith("|")) {
      if (/Pêché/i.test(raw) || /FAO/i.test(raw)) {
        const allFAO = [...raw.matchAll(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/gi)];
        if (allFAO.length) {
          const last = allFAO[allFAO.length - 1];
          current.zone = `FAO${last[1]}`;
          current.sousZone = last[2]
            ? last[2].toUpperCase().replace(/\./g, "")
            : "";
          current.fao = `${current.zone} ${current.sousZone}`.trim();
        }
        if (/Elevé/i.test(raw)) {
          const elevMatch = raw.match(/Elevé.+?en\s*:?[\sA-Za-z]*?([A-Za-zéèêàç]+)/i);
          const pays = elevMatch ? elevMatch[1].trim() : "";
          current.zone = "ÉLEVAGE";
          current.sousZone = pays ? pays.toUpperCase() : "";
          current.fao = `ÉLEVAGE ${current.sousZone}`.trim();
        }
      }

      if (/Engin/i.test(raw)) {
        const m = raw.match(/Engin\s*:\s*(.+)$/i);
        if (m) current.engin = m[1].trim();
      }

      if (/Lot/i.test(raw)) {
        const m = raw.match(/Lot\s*:\s*(\S+)/i);
        if (m) current.lot = m[1].trim();
      }
    }
  }

  // Dernier bloc
  if (current) rows.push(current);

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
