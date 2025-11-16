/**************************************************
 * IMPORT DISTRIMER (10002)
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
    text += content.items.map(i => i.str).join("\n");
    text += "\n";
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
 * Normalisation ref fournisseur (EMISP/6 → EMISP_06)
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");
  return r.toUpperCase();
}

/**************************************************
 * EXTRACT FAO — handle VIa, IVa, VIb, "et", multi-FAO
 **************************************************/
function extractFAOs(bio) {
  if (!bio) return [];

  // 1) On isole tout ce qui ressemble à "FAO 27 …"
  const blocks = bio
    .split(/FAO/i)
    .slice(1)
    .map(b => b.trim());

  const out = [];

  for (let blk of blocks) {
    // On coupe quand on retombe sur un séparateur fort
    blk = blk.split(/[-–]|Chalut|Casier|Ligne|Filet|Mail/i)[0].trim();

    // Exemple blk = "27 VIa et IVa"
    // On extrait le numéro FAO : 27
    const numMatch = blk.match(/^([0-9]{1,3})/);
    if (!numMatch) continue;

    const num = numMatch[1];
    let rest = blk.replace(num, "").trim();

    // On split par "et", "/", virgule
    const parts = rest.split(/et|\/|,/i).map(s => s.trim());

    for (let p of parts) {
      // p = "VIa" / "IVa" / "VI Ouest Ecosse"
      const m = p.match(/^([IVX]+)([a-zA-Z]?)?/i);
      if (!m) continue;

      const roman = (m[1] || "").toUpperCase();
      let letter = (m[2] || "").toLowerCase();

      // ⚠️ exclusion des faux "O" = Ouest Ecosse
      if (/ouest|ecosse/i.test(p)) letter = "";

      // On construit proprement
      const final = `FAO ${num} ${roman}${letter}`.trim();
      out.push(final);
    }
  }

  // Nettoyage doublons
  return [...new Set(out)];
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
    const designation    = (lines[i+1] || "").trim();
    const colis          = parseFloat((lines[i+2] || "").replace(",", "."));
    const poidsColisKg   = parseFloat((lines[i+3] || "").replace(",", "."));
    const quantite       = parseFloat((lines[i+4] || "").replace(",", "."));
    const uv             = (lines[i+5] || "").trim();
    const lot            = (lines[i+6] || "").trim();

    let prixKg = 0;
    if ((lines[i+7] || "").includes("€"))
      prixKg = parseFloat(lines[i+7].replace("€","").replace(",","."));

    let montantHT = 0;
    if ((lines[i+8] || "").includes("€"))
      montantHT = parseFloat(lines[i+8].replace("€","").replace(",","."));

    const bio = (lines[i+10] || "").trim();

    // FAO multi-zones
   const faoList = extractFAOs(bio);
const fao = faoList.join(", ");   // => "FAO 27 VIa, FAO 27 IVa"


    // Nom latin
    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    // Engin
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
      fao: faoList.join(", "),
faos: faoList,  // si tu veux garder un tableau
zone: "",
sousZone: "",
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

    // AF_MAP -> priorité
    if (M) {
      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");
      cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();

      if (cleanFromAF) {
        L.designation = cleanFromAF;
        designationInterne = cleanFromAF;
      }

      if (M.nomLatin) L.nomLatin = M.nomLatin;
      if (M.zone)     L.zone = M.zone;
      if (M.sousZone) L.sousZone = M.sousZone;
      if (M.engin)    L.engin = M.engin;
    }

    // Articles → fallback
    if (plu && artMap[plu]) {
      const art = artMap[plu];

      const artDesignation =
        (art.Designation || art.designation || art.designationInterne || "").trim();

      if (!cleanFromAF && artDesignation) {
        L.designation = artDesignation;
        designationInterne = artDesignation;
      }

      if (art.Zone)     L.zone = art.Zone;
      if (art.SousZone) L.sousZone = art.SousZone;
      if (art.Engin)    L.engin = art.Engin;
    }

    // SAVE LIGNE
const lineDef = {
    ...L,

    // 🔥 NOUVEAU : toutes les FAO (string + array)
    fao: (L.faos && L.faos.length) ? L.faos.join(", ") : (L.fao || ""),
    faos: L.faos || [],

    plu,
    designationInterne,
    fournisseurRef: L.refFournisseur,
    prixHTKg: L.prixKg,
    montantTTC: L.montantHT,

    // zone/sous-zone restent, mises à jour par AF_MAP ou Article
    zone: L.zone || "",
    sousZone: L.sousZone || "",
    engin: L.engin || "",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
};

const lineRef = await addDoc(
  collection(db, "achats", achatId, "lignes"),
  lineDef
);


    // Auto-patch après popup
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

    // Pour popup AF_MAP
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

  // Popup AF_MAP
  if (missing.length > 0) {
    console.warn("🔎 Mapping manquant Distrimer :", missing);
    const mod = await import("./manage-af-map.js");
    mod.manageAFMap(missing);
  }
}

/**************************************************
 * ENTRY
 **************************************************/
export async function importDistrimer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parsedistrimer(text);
  await savedistrimer(lines);
}
