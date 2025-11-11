/**************************************************
 * IMPORT SCAPMAREE (10001)
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


const FOUR_CODE = "10001"; // SCAPMAREE

/**************************************************
 * Charger AF_MAP  →  { "10001__REF": {...} }
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};

  snap.forEach(d => {
    map[d.id] = d.data();
  });

  console.log("✅ AF MAP loaded:", Object.keys(map).length, "items");
  return map;
}

/**************************************************
 * Charger fiche fournisseur
 **************************************************/
async function loadSupplierInfo() {
  const ref = doc(db, "fournisseurs", FOUR_CODE);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { code: FOUR_CODE, nom: "SCAPMAREE" };
  return snap.data();
}

/**************************************************
 * LECTURE XLSX
 **************************************************/
function readWorkbookAsync(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        resolve(wb);
      } catch (err) {
        reject(err);
      }
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

/**************************************************
 * IMPORT
 **************************************************/
export async function importScapmaree(file) {
  try {
    const afMap = await loadAFMap();
    const supplier = await loadSupplierInfo();

    const wb = await readWorkbookAsync(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const achatId = await createAchatHeader(supplier);

    await saveScapToFirestore(achatId, rows, afMap);

    alert("✅ Import SCAPMAREE terminé");
    location.reload();

  } catch (e) {
    console.error("❌ Import SCAPMAREE:", e);
    alert("Erreur import SCAPMAREE : " + e.message);
  }
}

/**************************************************
 * Create achat header
 **************************************************/
async function createAchatHeader(supplier) {
  const colAchats = collection(db, "achats");
  const docRef = await addDoc(colAchats, {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code || FOUR_CODE,
    fournisseurNom: supplier.nom || "SCAPMAREE",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    statut: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    type: "BL"
  });

  console.log("✅ Achat header créé:", docRef.id);
  return docRef.id;
}

/**************************************************
 * SAVE
 **************************************************/
async function saveScapToFirestore(achatId, rows, afMap) {

  let totalHT = 0;
  let totalTTC = 0;
  let totalKg = 0;

  const missingRefs = [];   // <-- NEW

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.length) continue;

    let ref = (r[0] ?? "").toString().trim();
    ref = ref.replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    const designation = r[1] ?? "";
    const nomLatin    = r[2] ?? "";

    const poidsTotalKg = parseFloat(r[7] ?? 0);
    const prixKg       = parseFloat(r[8] ?? 0);
    const montantHT    = parseFloat(r[9] ?? 0);

    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const map = afMap[key];

    let plu = "";
    let designationInterne = designation;
    let allergenes = "";
    let zone = "";
    let sousZone = "";
    let engin = "";

    if (map?.plu) {
      plu = map.plu;
      designationInterne = map?.designationInterne || designation;
      allergenes = map?.allergenes || "";
      zone = map?.zone || "";
      sousZone = map?.sousZone || "";
      engin = map?.engin || "";
    } else {
      // ✅ Collecte des refs sans map
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: ref,
        designation
      });
    }

    totalHT  += montantHT;
    totalTTC += montantHT;
    totalKg  += poidsTotalKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
      fournisseurRef: ref,

      plu,
      designation,
      designationInterne,
      nomLatin,
      zone,
      sousZone,
      engin,
      allergenes,

      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg,
      prixKg,
      montantHT,
      montantTTC: montantHT,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  const refA = doc(db, "achats", achatId);
  await updateDoc(refA, {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp()
  });

  console.log("🔎 Missing refs:", missingRefs);

  // ✅ UI mappage si refs non trouvées
  await manageAFMap(missingRefs);
}
