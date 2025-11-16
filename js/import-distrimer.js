/**************************************************
 * IMPORT distrimer (10002)
 * Version finale — multi-FAO + popup AF_MAP
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
 * Détection code article Distrimer
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|DISTRIMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE/i.test(s);

/**************************************************
 * Normalisation ref fournisseur → format constant
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");

  // EMISP_6 → EMISP_06
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");

  return r.toUpperCase();
}

/**************************************************
 * Parse Distrimer (PDF → lignes)
 **************************************************/
export function parsedistrimer(text) {

  const rows = [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!isArticleCode(line)) {
      i++;
      continue;
    }

    const refFournisseur = normalizeRef(line);

    const designation   = (lines[i+1] || "").trim();
    const colis         = parseFloat((lines[i+2] || "").replace(",", "."));
    const poidsColisKg  = parseFloat((lines[i+3] || "").replace(",", "."));
    const quantite      = parseFloat((lines[i+4] || "").replace(",", "."));
    const uv            = (lines[i+5] || "").trim();
    const lot           = (lines[i+6] || "").trim();

    // prix/kg
    let prixKg = 0;
    if ((lines[i+7] || "").includes("€"))
      prixKg = parseFloat(lines[i+7].replace("€","").replace(",","."));

    // montant HT
    let montantHT = 0;
    if ((lines[i+8] || "").includes("€"))
      montantHT = parseFloat(lines[i+8].replace("€","").replace(",","."));

    const bio = (lines[i+10] || "").trim();

    /**************************************************
 * Extraction FAO ultra-fiable
 * - prend TOUTES les FAO
 * - ignore “Ouest”, “Ecosse”, etc.
 * - gère FAO 27 VIa
 **************************************************/
function extractFAOs(bio) {

  // Exemples reconnus :
  // FAO 27 VIa
  // FAO27 VIb
  // FAO 27 IV
  // FAO 27 VIIc

  const regex = /FAO\s*([0-9]{1,3})\s*([IVX]{1,4})?\s*([A-Za-z])?/gi;

  let list = [];
  let m;

  while ((m = regex.exec(bio)) !== null) {
    const num = m[1];
    const roman = m[2] ? m[2].toUpperCase() : "";
    let letter = m[3] ? m[3].toUpperCase() : "";

    // ❌ On supprime les lettres invalides ("O" = Ouest)
    if (letter === "O") letter = "";

    // Construction propre
    const fao = `FAO ${num} ${roman}${letter}`.trim();
    list.push(fao);
  }

  return list;
}

    /**************************************************
     * Nom latin
     **************************************************/
    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    /**************************************************
     * Engin
     **************************************************/
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|FILTS/gi);
    if (engMatch) engin = engMatch[0];

    if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
    if (/FILTS/i.test(engin))   engin = "FILET TOURNANT";

    rows.push({
      refFournisseur,
      designation,
      colis,
      poidsColisKg,
      poidsTotalKg: quantite,
      prixKg,
      montantHT,
      uv,
      lot,
      nomLatin,
      zone,
      sousZone,
      engin,
      fao,
      autresFAO: faoList.slice(1)  // stocke le reste
    });

    i += 11;
  }

  return rows;
}

/**************************************************
 * AF_MAP smart match
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {
  const clean = (ref || "").trim().toUpperCase();

  const keyExact  = `${fourCode}__${clean}`;
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/,"")}`;
  const keyPadded = `${fourCode}__${clean.replace(/^(\D+)(\d)$/,"$10$2")}`;

  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPadded] || null;
}

/**************************************************
 * SAVE Distrimer
 **************************************************/
async function savedistrimer(lines) {

  const FOUR_CODE = "10002";
  if (!lines.length) throw new Error("Aucune ligne Distrimer détectée");

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
    fournisseurNom: "Distrimer",
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
    }

    if (plu && artMap[plu]) {
      const art = artMap[plu];
      const artDesignation =
        (art.Designation || art.designation || art.designationInterne || "").trim();
      if (!cleanFromAF && artDesignation) {
        L.designation = artDesignation;
        designationInterne = artDesignation;
      }
    }

    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu,
      designationInterne,
      fournisseurRef: L.refFournisseur,
      prixHTKg: L.prixKg,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const lineId = lineRef.id;

    // PATCH auto-update après popup
    if (!M) {
      setTimeout(async () => {
        const key = (`10002__${L.refFournisseur}`).toUpperCase();
        const snap = await getDoc(doc(db, "af_map", key));
        if (!snap.exists()) return;

        const mapped = snap.data();

        await updateDoc(
          doc(db, "achats", achatId, "lignes", lineId),
          {
            plu: mapped.plu || "",
            designationInterne: mapped.designationInterne || "",
            designation: mapped.designationInterne || "",
            updatedAt: serverTimestamp()
          }
        );
      }, 500);
    }

    if (!M) {
      missing.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation,
        designationInterne,
        aliasFournisseur: L.designation,
        nomLatin: L.nomLatin || "",
        zone: L.zone || "",
        sousZone: L.sousZone || "",
        engin: L.engin || "",
        allergenes: "",
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

  if (missing.length > 0) {
    console.warn("🔎 mapping manquant Distrimer :", missing);
    const mod = await import("./manage-af-map.js");
    mod.manageAFMap(missing);
  }
}

/**************************************************
 * ENTRY POINT
 **************************************************/
export async function importDistrimer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parsedistrimer(text);
  await savedistrimer(lines);
}
