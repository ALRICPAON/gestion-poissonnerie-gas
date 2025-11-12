/**************************************************
 * IMPORT CRIÉE AUTO (Détecte Format A / B)
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  serverTimestamp,
  updateDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { manageAFMap } from "./manage-af-map.js";

const FOUR_CODE = "81268";

/**************************************************
 * AF MAP
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach((d) => (map[d.id] = d.data()));
  return map;
}

/**************************************************
 * Fournisseur
 **************************************************/
async function loadSupplierInfo() {
  const snap = await getDoc(doc(db, "fournisseurs", FOUR_CODE));
  return snap.exists()
    ? snap.data()
    : { code: FOUR_CODE, nom: "CRIÉE ST-GILLES" };
}

/**************************************************
 * XLSX → workbook
 **************************************************/
function readWorkbookAsync(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), {
          type: "array",
        });
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
 * HEADER ACHAT
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
 * PARSE FORMAT A
 * (L’ancien que tu avais)
 **************************************************/
function parseFormatA(row) {
  return {
    ref: row[0] ?? "",
    designation: row[1] ?? "",
    nomLatin: row[2] ?? "",
    prix: parseFloat(row[6] ?? 0),
    poids: parseFloat(row[7] ?? 0),
    total: parseFloat(row[8] ?? 0),
    zone_raw: row[10] ?? "",
    sous_raw: row[11] ?? "",
    engin: row[12] ?? "",
  };
}

/**************************************************
 * PARSE FORMAT B  ✅
 **************************************************/
function parseFormatB(row) {
  return {
    ref: row[1] ?? "",
    designation: row[2] ?? "",
    nomLatin: row[3] ?? "",
    prix: parseFloat(row[7] ?? 0),
    poids: parseFloat(row[8] ?? 0),
    total: parseFloat(row[9] ?? 0),
    zone_raw: row[12] ?? "",
    sous_raw: row[13] ?? "",
    engin: row[14] ?? "",
  };
}

/**************************************************
 * AUTO DETECT FORMAT
 **************************************************/
function detectFormat(rows) {
  const header = rows[0];
  if (!header) return "A";

  // Format B → nom latin colonne D = row[3]
  const hasNomLatinAtD = header[3] && header[3].toString().toLowerCase().includes("latin");

  if (hasNomLatinAtD) return "B";
  return "A";
}

/**************************************************
 * SAVE
 **************************************************/
async function saveCrieeToFirestore(achatId, rows, afMap) {
  let totalHT = 0;
  let totalKg = 0;

  let missingRefs = [];

  const format = detectFormat(rows);
  console.log("📁 Détection format CRIÉE =", format);

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.length) continue;

    const raw = format === "B" ? parseFormatB(r) : parseFormatA(r);

    let ref = raw.ref.toString().trim().replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    let { designation, nomLatin, prix, poids, total, zone_raw, sous_raw, engin } = raw;

    /* FAO */
    const zone = zone_raw?.toString().trim();
    const sousZone = sous_raw?.toString().trim();
    const fao = (zone && sousZone) ? `FAO ${zone} ${sousZone}` : "";

    /* MAP */
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const M = afMap[key];

    let plu = M?.plu ?? "";
    if (plu.endsWith(".0")) plu = plu.slice(0, -2);

    let designationInterne = M?.designationInterne || designation;
    let allergenes = M?.allergenes || "";
    let zoneF = M?.zone || zone;
    let sousZoneF = M?.sousZone || sousZone;
    let enginF = M?.engin || engin;

    // Update totals
    totalHT += total;
    totalKg += poids;

    // D’abord on insère la ligne
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
      fournisseurRef: ref,

      plu,
      designation,
      designationInterne,
      nomLatin,

      zone: zoneF,
      sousZone: sousZoneF,
      engin: enginF,
      allergenes,
      fao,

      poidsKg: poids,
      poidsTotalKg: poids,

      prixHTKg: prix,
      prixKg: prix,
      montantHT: total,
      montantTTC: total,

      colis: 0,
      poidsColisKg: 0,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const ligneId = lineRef.id;

    // Manque MAP ?  → enregistrer
    if (!M?.plu) {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: ref,
        designation,
        achatId,
        ligneId,
      });
    }
  }

  /* update achat */
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp(),
  });

  /* Popup MAP */
  if (missingRefs.length > 0) {
    await manageAFMap(missingRefs);
    return true;
  }

  return false;
}

/**************************************************
 * ENTRY POINT
 **************************************************/
export async function importCriee(file) {
  const afMap = await loadAFMap();
  const supplier = await loadSupplierInfo();

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);
  const hasMissing = await saveCrieeToFirestore(achatId, rows, afMap);

  if (!hasMissing) {
    alert("✅ Import CRIÉE OK");
    location.reload();
  } else {
    alert("⚠️ Références à associer → voir popup");
  }
}
