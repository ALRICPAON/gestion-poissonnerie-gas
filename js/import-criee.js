/**************************************************
 * IMPORT CRIÉE — 2 variantes
 *  - MODELE 1 → PLU col A → FOUR_CODE = 81269
 *  - MODELE 2 → PLU col B → FOUR_CODE = 81268
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { manageAFMap } from "./manage-af-map.js";

/**************************************************
 * LOADERS
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

async function loadArticlesMap() {
  const snap = await getDocs(collection(db, "articles"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

async function loadSupplierInfo(fourCode, fallbackNom) {
  const snap = await getDoc(doc(db, "fournisseurs", fourCode));
  return snap.exists()
    ? snap.data()
    : { code: fourCode, nom: fallbackNom };
}

/**************************************************
 * XLSX → JS rows
 **************************************************/
function readWorkbookAsync(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        resolve(wb);
      } catch (e) {
        reject(e);
      }
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

/**************************************************
 * Create achat header
 **************************************************/
async function createAchatHeader(supplier) {
  const ref = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code,
    fournisseurNom: supplier.nom,
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    statut: "new",
    type: "BL",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**************************************************
 * GENERIC SAVE
 **************************************************/
async function saveLines(achatId, rows, afMap, artMap, fourCode, colMap) {

  let totalHT = 0;
  let totalKg = 0;
  const missingRefs = [];

  // skip header row 0
  for (let i = 1; i < rows.length; i++) {

    const r = rows[i] || [];
    if (!r.length) continue;

    let ref = r[colMap.plu] ?? "";
    ref = ref.toString().trim().replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    const designation   = r[colMap.designation] ?? "";
    const nomLatin      = r[colMap.latin]      ?? "";
    const prixHTKg      = parseFloat(r[colMap.prixHTKg]   ?? 0);
    const poidsKg       = parseFloat(r[colMap.poidsKg]    ?? 0);
    const montantHT     = parseFloat(r[colMap.montantHT]  ?? 0);
    
    let zone            = r[colMap.zone]       ?? "";
    let sousZone        = r[colMap.sousZone]   ?? "";
    const engin         = r[colMap.engin]      ?? "";

    const fao = (zone && sousZone) ? `FAO${zone} ${sousZone}` : "";

    /************************************
     *  AF MAP
     ************************************/
    const key = `${fourCode}__${ref}`.toUpperCase();
    const M = afMap[key];

    let plu = (M?.plu ?? "").toString().trim();
    if (plu.endsWith(".0")) plu = plu.slice(0, -2);

    let designationInterne = M?.designationInterne || designation;
    let allergenes         = M?.allergenes || "";

    /************************************
     * fallback article
     ************************************/
    if (!plu) {
      const art = Object.values(artMap).find(a =>
        a.designation?.toUpperCase() === designation.toUpperCase()
      );
      if (art) {
        plu = art.id || plu;
        if (art.zone)     zone = art.zone;
        if (art.sousZone) sousZone = art.sousZone;
      }
    }

    if (!M?.plu) {
      missingRefs.push({ fournisseurCode: fourCode, refFournisseur: ref, designation, achatId });
    }

    totalHT += montantHT;
    totalKg += poidsKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {

      refFournisseur: ref,
      fournisseurRef: ref,

      plu,
      designation,
      designationInterne,
      nomLatin,

      zone,
      sousZone,
      fao,
      engin,
      allergenes,

      poidsKg,
      prixHTKg,
      prixKg: prixHTKg,
      montantHT,
      montantTTC: montantHT,

      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg: poidsKg,

      received: false,
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

  if (missingRefs.length > 0) {
    console.log("🔎 Missing refs:", missingRefs);
    await manageAFMap(missingRefs);
  }
}

/**************************************************
 * IMPORT MODELE 1 (PLU col A → FOUR_CODE = 81269)
 **************************************************/
export async function importCrieePLUcolA(file) {

  const fourCode = "81269";
  const fourName = "Criée Les Sables";

  const afMap    = await loadAFMap();
  const artMap   = await loadArticlesMap();
  const supplier = await loadSupplierInfo(fourCode, fourName);

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);

  await saveLines(achatId, rows, afMap, artMap, fourCode, {
    plu:        0,  // A
    designation:1,  // B
    latin:      2,  // C
    prixHTKg:   6,  // G
    poidsKg:    7,  // H
    montantHT:  8,  // I
    zone:      10,  // K
    sousZone:  11,  // L
    engin:     12   // M
  });

  alert("✅ Import CRIÉE PLU Col A OK");
  location.reload();
}

/**************************************************
 * IMPORT MODELE 2 (PLU col B → FOUR_CODE = 81268)
 **************************************************/
export async function importCrieePLUcolB(file) {

  const fourCode = "81268";
  const fourName = "Criée St-Gilles";

  const afMap    = await loadAFMap();
  const artMap   = await loadArticlesMap();
  const supplier = await loadSupplierInfo(fourCode, fourName);

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);

  await saveLines(achatId, rows, afMap, artMap, fourCode, {
    plu:        1,  // B
    designation:2,  // C
    latin:      3,  // D
    prixHTKg:   7,  // H
    poidsKg:    8,  // I
    montantHT:  9,  // J
    zone:      11,  // L
    sousZone:  12,  // M
    engin:     13   // N
  });

  alert("✅ Import CRIÉE PLU Col B OK");
  location.reload();
}
