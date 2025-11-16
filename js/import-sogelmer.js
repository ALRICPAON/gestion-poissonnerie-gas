/**************************************************
 * IMPORT SOGELMER (10003)
 * Version finale — multi-FAO + multi-latin + popup OK
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp,
  updateDoc, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * PDF → texte
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) throw new Error("PDF.js non chargé");

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join("\n") + "\n";
  }
  return text;
}

/**************************************************
 * Détection code article
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|SOGELMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE/i.test(s);

/**************************************************
 * Normalisation réf fournisseur
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");
  return r.toUpperCase();
}

/**************************************************
 * ⚠️ Multi-FAO complète (VIa, IVc, b, etc.)
 **************************************************/
function extractFAOs(bio) {
  if (!bio) return [];

  const blocks = bio.split(/FAO/i).slice(1).map(b => b.trim());
  const out = [];

  for (let blk of blocks) {

    blk = blk.split(/[-–]|Chalut|Ligne|Filet|Mail|Casier|Peche/i)[0].trim();

    const num = (blk.match(/^([0-9]{1,3})/) || [])[1];
    if (!num) continue;

    let rest = blk.replace(num, "").trim();

    const parts = rest.split(/et|,|\//i).map(p => p.trim());

    for (let p of parts) {
      const m = p.match(/^([IVX]+)([a-zA-Z]?)?/i);
      if (!m) continue;

      const roman = m[1].toUpperCase();
      let letter = (m[2] || "").toLowerCase();

      if (/ouest|ecosse/i.test(p)) letter = "";

      const final = `FAO ${num} ${roman}${letter}`.trim();
      out.push(final);
    }
  }

  return [...new Set(out)];
}

/**************************************************
 * Multi-Latin (extraction robuste)
 **************************************************/
function extractLatinNames(bio) {
  if (!bio) return [];

  const latinRegex = /\b[A-Z][a-z]+(?: [a-z]+)?\b/g;
  const found = bio.match(latinRegex) || [];

  return [...new Set(found)];
}

/**************************************************
 * Parse SOGELMER → lignes
 **************************************************/
export function parseSogelmer(text) {

  const rows = [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  let i = 0;

  while (i < lines.length) {

    const line = lines[i];
    if (!isArticleCode(line)) { i++; continue; }

    const refFournisseur = normalizeRef(line);

    const designation = (lines[i + 1] || "").trim();
    const colis        = parseFloat((lines[i + 2] || "").replace(",", "."));
    const poidsColisKg = parseFloat((lines[i + 3] || "").replace(",", "."));
    const quantite     = parseFloat((lines[i + 4] || "").replace(",", "."));
    const uv           = (lines[i + 5] || "").trim();
    const lot          = (lines[i + 6] || "").trim();

    let prixKg = 0;
    if ((lines[i + 7] || "").includes("€"))
      prixKg = parseFloat(lines[i + 7].replace("€", "").replace(",", "."));

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€", "").replace(",", "."));

    const bio = (lines[i + 10] || "").trim();

    // Multi latin
    const latinList = extractLatinNames(bio);

    // Multi FAO
    const faoList = extractFAOs(bio);

    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|Casier/gi);
    if (engMatch) engin = engMatch[0].toUpperCase();

    if (/MAIL/i.test(engin)) engin = "FILET MAILLANT";

    rows.push({
      refFournisseur,
      designation,
      colis,
      poidsColisKg,
      poidsTotalKg: quantite,
      uv,
      lot,
      prixKg,
      montantHT,
      bio,
      faos: faoList,
      fao: faoList.join(", "),
      nomLatin: latinList.join(", "),
      latinList,
      engin
    });

    i += 11;
  }

  return rows;
}

/**************************************************
 * AF_MAP smart match
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {
  const clean = (ref || "").toString().trim().toUpperCase();

  return (
    afMap[`${fourCode}__${clean}`] ||
    afMap[`${fourCode}__${clean.replace(/^0+/, "")}`] ||
    afMap[`${fourCode}__${clean.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2")}`] ||
    null
  );
}

/**************************************************
 * SAVE SOGELMER
 **************************************************/
async function saveSogelmer(lines) {

  const FOUR_CODE = "10003";

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => afMap[d.id.toUpperCase()] = d.data());

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a.plu) artMap[a.plu.toString()] = a;
  });

  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0,10),
    fournisseurCode: FOUR_CODE,
    fournisseurNom: "SOGELMER",
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const achatId = achatRef.id;

  let totalHT = 0;
  let totalKg = 0;

  const missing = [];

  for (const L of lines) {

    totalHT += Number(L.montantHT || 0);
    totalKg += Number(L.poidsTotalKg || 0);

    let plu = "";
    let designationInterne = L.designation;
    let cleanFromAF = "";

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    if (M) {
      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");
      cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();

      if (cleanFromAF) {
        L.designation = cleanFromAF;
        designationInterne = cleanFromAF;
      }

      if (M.nomLatin) L.nomLatin = M.nomLatin;
      if (M.zone) L.zone = M.zone;
      if (M.sousZone) L.sousZone = M.sousZone;
      if (M.engin) L.engin = M.engin;
    }

    if (plu && artMap[plu]) {
      const art = artMap[plu];

      const artDesignation =
        (art.Designation || art.designation || art.designationInterne || "").trim();

      if (!cleanFromAF && artDesignation) {
        L.designation = artDesignation;
        designationInterne = artDesignation;
      }

      if (art.Zone) L.zone = art.Zone;
      if (art.SousZone) L.sousZone = art.SousZone;
      if (art.Engin) L.engin = art.Engin;
    }

    const lineRef = await addDoc(
      collection(db, "achats", achatId, "lignes"),
      {
        ...L,
        plu,
        designationInterne,
        fournisseurRef: L.refFournisseur,
        fao: L.fao,
        faos: L.faos,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    const lineId = lineRef.id;

    if (!M) {
      missing.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation,
        designationInterne,
        aliasFournisseur: L.designation,
        nomLatin: L.nomLatin,
        zone: L.zone || "",
        sousZone: L.sousZone || "",
        engin: L.engin || "",
        achatId,
        ligneId: lineId
      });
    }
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  // Popup AF_MAP
  if (missing.length > 0) {
    const mod = await import("./manage-af-map.js");
    return mod.manageAFMap(missing);
  }

  // Aucun mapping → refresh auto
  setTimeout(() => location.reload(), 300);
}

/**************************************************
 * ENTRY POINT
 **************************************************/
export async function importSogelmer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseSogelmer(text);
  await saveSogelmer(lines);
}
