/******************************************************
 * IMPORT CRIEE DES SABLES — totalement isolé
 ******************************************************/
console.log(">> import CRIEE loaded");

import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, getDoc, getDocs, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// -----------------------------------------
// CONSTANTE FOURNISSEUR CRIEE
// -----------------------------------------
const CRIEE_CODE = "81269";


// -----------------------------------------
// 1) Charge AF_MAP PRIVÉ
//    => indexé par refFournisseur (col A)
// -----------------------------------------
async function loadAFMapCriee_PRIVATE() {

  console.log("LOAD AF MAP CRIÉE → PRIVATE");

  const snap = await getDocs(collection(db, "af_map"));
  const map = {};

  snap.forEach(d => {
    const r = d.data();
    if (!r) return;

    // Filtres
    if (String(r.fournisseurCode) !== CRIEE_CODE) return;

    let ref = (r.refFournisseur ?? "").toString().trim();
    if (!ref) return;

    // retire zéros devant
    ref = ref.replace(/^0+/, "");

    map[ref] = {
      plu: r.plu ?? null,
      designationInterne: r.designationInterne ?? "",
      aliasFournisseur: r.aliasFournisseur ?? "",
    };
  });

  console.log("✅ MAP CRIEE PRIVÉ =", map);
  return map;
}



// -----------------------------------------
// 2) Charge info fournisseur
// -----------------------------------------
async function loadSupplierInfo_PRIVATE() {
  const ref = doc(db, "fournisseurs", CRIEE_CODE);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { code: CRIEE_CODE, nom: "Criée" };
  return snap.data();
}



// -----------------------------------------
// 3) LECTURE XLSX — PRIVÉ
// -----------------------------------------
function readWorkbookAsync(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        resolve(wb);
      } catch(err) {
        reject(err);
      }
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}



// -----------------------------------------
// 4) HEADER ACHAT
// -----------------------------------------
async function createAchatHeader_PRIVATE(supplier) {
  const docRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code,
    fournisseurNom: supplier.nom,
    montantHT: 0,
    montantTTC: 0,
    statut: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  console.log("✅ Header Achat créé :", docRef.id);
  return docRef.id;
}



// -----------------------------------------
// 5) CONVERSION SOUS-ZONE
// -----------------------------------------
function convertFAO(n) {
  const map = {
    "27": "VIII",
    "080": "VIII",
    "081": "VIII",
  };
  return map[n] ?? n;
}



// -----------------------------------------
// 6) INSERT LIGNES + CALCUL
// -----------------------------------------
async function saveCrieeLines_PRIVATE(achatId, sheetData, afMap) {

  let totalHT = 0;
  let totalTTC = 0;
  let totalKg = 0;

  for (let i = 1; i < sheetData.length; i++) {

    const r = sheetData[i];
    if (!r || !r.length) continue;

    let codeArt = (r[0] ?? "").toString().trim();
    codeArt = codeArt.replace(/^0+/, "");

    const designation = r[1] ?? "";
    const nomLatin   = r[2] ?? "";
    const prixHTKg   = parseFloat(r[6] ?? 0);
    const poidsKg    = parseFloat(r[7] ?? 0);
    const totalLigne = parseFloat(r[8] ?? 0);

    const zoneRaw     = (r[10] ?? "").toString();
    const sousZoneRaw = (r[11] ?? "").toString();
    const engin       = (r[12] ?? "").toString();

    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = sousZoneRaw.match(/\((\d+)\)/);
    let sousZone = subMatch ? convertFAO(subMatch[1]) : "";

    const fao = (zone && sousZone) ? `FAO${zone} ${sousZone}` : "";

    // 🔥 MATCH PLU
    const rec = afMap[codeArt];
    const plu = rec?.plu ?? null;
    const designationInterne = rec?.designationInterne ?? designation;

    totalHT  += totalLigne;
    totalTTC += totalLigne * 1.1;
    totalKg  += poidsKg;

    await addDoc(collection(db,"achats",achatId,"lignes"), {
      codeArticle: codeArt,
      plu,
      designation,
      designationInterne,
      nomLatin,
      poidsKg,
      prixHTKg,
      totalHT: totalLigne,
      fao,
      zone,
      sousZone,
      engin,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    console.log(`✅ LIGNE ${codeArt} → PLU=`, plu);
  }


  await updateDoc(doc(db,"achats",achatId), {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp(),
  });
}



// -----------------------------------------
// 7) HANDLER BOUTON
// -----------------------------------------
document.getElementById("importCrieeBtn")?.addEventListener("click", async () => {

  try {
    const file = document.getElementById("crieeFile")?.files[0];
    if (!file) return alert("Choisis un fichier XLSX/CSV");

    const status = document.getElementById("importStatus");
    status.textContent = "Lecture…";

    // map privé
    const afMap = await loadAFMapCriee_PRIVATE();
    const supplier = await loadSupplierInfo_PRIVATE();

    const wb = await readWorkbookAsync(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const achatId = await createAchatHeader_PRIVATE(supplier);

    status.textContent = "Import lignes…";
    await saveCrieeLines_PRIVATE(achatId, json, afMap);

    alert("✅ Import Terminé");
    location.reload();

  } catch (err) {
    console.error(err);
    alert("Erreur import : " + err.message);
  }

});
