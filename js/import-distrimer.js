/**************************************************
 * IMPORT DISTRIMER (10002)
 * Version finale — FAO multiples + structure SOGELMER
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs, getDoc
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
 * Détection code Distrimer
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|DISTRIMER|PAGE|DATE|POIDS|FACTURE|BL|FR|STEF/i.test(s);

/**************************************************
 * Normalisation Référence fournisseur
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");
  return r.toUpperCase();
}

/**************************************************
 * EXTRACT FAO — multi-FAO (VIa / IVa / VI Ouest…)
 **************************************************/
function extractFAOs(bio) {
  if (!bio) return [];

  const blocks = bio
    .split(/FAO/i)
    .slice(1)
    .map(b => b.trim());

  const out = [];

  for (let blk of blocks) {
    blk = blk.split(/Chalut|Casier|Ligne|Filet|Mail|-/i)[0].trim();

    const numMatch = blk.match(/^([0-9]{1,3})/);
    if (!numMatch) continue;

    const num = numMatch[1];
    let rest = blk.replace(num, "").trim();

    const parts = rest.split(/et|\/|,/i).map(s => s.trim());

    for (let p of parts) {
      const m = p.match(/^([IVX]+)([a-zA-Z]?)?/i);
      if (!m) continue;

      const roman = (m[1] || "").toUpperCase();
      let letter = (m[2] || "").toLowerCase();

      if (/ouest|ecosse/i.test(p)) letter = "";

      const final = `FAO ${num} ${roman}${letter}`.trim();
      out.push(final);
    }
  }

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
      prixKg = parseFloat(lines[i+7].replace("€","").replace(",", "."));

    let montantHT = 0;
    if ((lines[i+8] || "").includes("€"))
      montantHT = parseFloat(lines[i+8].replace("€","").replace(",", "."));

    const bio = (lines[i+10] || "").trim();

    // FAO MULTIPLES
    const faos = extractFAOs(bio);
    const fao = faos.join(", ");

    // Latin
    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    // Engin
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Casier|Mail/gi);
    if (engMatch) engin = engMatch[0];

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
      fao,
      faos,

      zone: "",
      sousZone: "",
      engin
    });

    i += 11;
  }

  return rows;
}

/**************************************************
 * AF_MAP LOOKUP
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {
  const clean = (ref || "").trim().toUpperCase();
  return (
    afMap[`${fourCode}__${clean}`] ||
    afMap[`${fourCode}__${clean.replace(/^0+/, "")}`] ||
    afMap[`${fourCode}__${clean.replace(/^(\D+)(\d)$/, "$10$2")}`] ||
    null
  );
}

/**************************************************
 * SAVE Distrimer — version propre type SOGELMER
 **************************************************/
async function saveDistrimer(lines) {

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
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;
    const faos = L.faos;

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    /********* AF_MAP PRIORITAIRE *********/
    if (M) {

      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");

      if (M.designationInterne) {
        L.designation = M.designationInterne;
        designationInterne = M.designationInterne;
      }

      if (M.nomLatin)     L.nomLatin = M.nomLatin;
      if (M.zone)         zone = M.zone;
      if (M.sousZone)     sousZone = M.sousZone;
      if (M.engin)        engin = M.engin;

      if (!fao && M.zone) {
        fao = `FAO ${M.zone} ${M.sousZone || ""}`.trim();
      }
    }

    /********* ARTICLE FALLBACK *********/
    if (plu && artMap[plu]) {
      const art = artMap[plu];

      const d2 = (art.Designation || art.designationInterne || "").trim();
      if (!M && d2) {
        L.designation = d2;
        designationInterne = d2;
      }

      if (!zone && art.Zone) zone = art.Zone;
      if (!sousZone && art.SousZone) sousZone = art.SousZone;
      if (!engin && art.Engin) engin = art.Engin;
    }

    /********* SAVE LIGNE *********/
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      fournisseurRef: L.refFournisseur,

      plu,
      designation: L.designation,
      designationInterne,
      nomLatin: L.nomLatin,

      fao,
      faos,
      zone,
      sousZone,
      engin,

      poidsKg: L.poidsTotalKg,
      prixHTKg: L.prixKg,
      montantHT: L.montantHT,

      colis: L.colis,
      poidsColisKg: L.poidsColisKg,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const ligneId = lineRef.id;

    /******** PATCH AF_MAP APRÈS POPUP ********/
    if (!M) {
      setTimeout(async () => {

        const key = (`10002__${L.refFournisseur}`).toUpperCase();
        const snap = await getDoc(doc(db, "af_map", key));
        if (!snap.exists()) return;

        const mp = snap.data();

        await updateDoc(doc(db, "achats", achatId, "lignes", ligneId), {
          plu: mp.plu || "",
          designationInterne: mp.designationInterne || "",
          designation: mp.designationInterne || "",
          updatedAt: serverTimestamp()
        });

      }, 500);
    }

    /******** MAPPING MANQUANT → POPUP ********/
    if (!M) {
      missing.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation || "",
        designationInterne,
        aliasFournisseur: L.designation || "",
        nomLatin: L.nomLatin || "",
        zone,
        sousZone,
        engin,
        achatId,
        ligneId: ligneId
      });
    }
  }

  /******** Update Achat ********/
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  /******** Popup ********/
  if (missing.length > 0) {
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
  await saveDistrimer(lines);
  alert("Import terminé !");
  location.reload();
}
