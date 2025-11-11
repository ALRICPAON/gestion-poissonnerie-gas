/**************************************************
 * IMPORT CRIÉE DES SABLES (code fournisseur = 81269)
 **************************************************/
console.log("LOAD AF CRIÉE CALLED");

import { db } from "../js/firebase-init.js";

import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const FOUR_CODE = "81269"; // ✅ CRIÉE DES SABLES

/**************************************************
 * Charge le mapping AF_MAP → indexé par refFournisseur (col A)
 **************************************************/
async function loadAFMapCriee() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};

  snap.forEach((d) => {
    const data = d.data();

    if (data.fournisseurCode !== FOUR_CODE) return;

    let refF = (data.refFournisseur ?? "").toString().trim();
    refF = refF.replace(/^0+/, "");
    if (!refF) return;

    map[refF] = {
      plu: data.plu ?? null,
      designationInterne: data.designationInterne ?? "",
      aliasFournisseur: data.aliasFournisseur ?? "",
    };
  });

  console.log("✅ AF MAP =", map);
  console.log("MAP KEYS =", Object.keys(map));
  console.log("LOAD AF MAP OUTSIDE CALLED");


  return map;
}


/**************************************************
 * Charge infos fournisseur => nom
 **************************************************/
async function loadSupplierInfo() {
  const ref = doc(db, "fournisseurs", FOUR_CODE);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { code: FOUR_CODE, nom: "CRIÉE" };
  return snap.data();
}

/**************************************************
 * Button handler
 **************************************************/
document
  .getElementById("importCrieeBtn")
  ?.addEventListener("click", handleImportCriee);

async function handleImportCriee() {
  try {
    const fileInput = document.getElementById("crieeFile");
    const divStatus = document.getElementById("importStatus");
    if (!fileInput?.files.length) {
      alert("Merci de choisir un fichier XLSX/CSV");
      return;
    }

    const file = fileInput.files[0];

    const afMap = await loadAFMapCriee();
    const supplier = await loadSupplierInfo();

    divStatus.textContent = "Lecture fichier…";

    // Parse XLSX
    const wb = await readWorkbookAsync(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Create entête
    const achatId = await createAchatHeader(supplier);

    divStatus.textContent = "Import des lignes…";

    await saveCrieeToFirestore(achatId, json, afMap);

    divStatus.textContent = "✅ Terminé";

    alert("Import CRIÉE terminé ✅");
    location.reload();

  } catch (e) {
    console.error("❌ Erreur import CRIÉE:", e);
    alert("Erreur durant l'import : " + e);
  }
}

/**************************************************
 * Async read XLSX
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
 * Crée l’entête achat
 **************************************************/
async function createAchatHeader(supplier) {
  const colAchats = collection(db, "achats");
  const docRef = await addDoc(colAchats, {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code || FOUR_CODE,
    fournisseurNom: supplier.nom || "CRIÉE DES SABLES",
    montantHT: 0,
    montantTTC: 0,
    statut: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  console.log("✅ Header achat créé:", docRef.id);
  return docRef.id;
}

/**************************************************
 * Sauvegarde lignes CRIÉE -> subcollection lignes
 **************************************************/
async function saveCrieeToFirestore(achatId, sheetData, afMap) {

  let totalHT = 0;
  let totalTTC = 0;
  let totalKg = 0;

  for (let i = 1; i < sheetData.length; i++) {
    const r = sheetData[i];
    if (!r || !r.length) continue;

    /*****************************
     * MAPPING COLONNES
     *****************************/
    let codeArt = (r[0] ?? "").toString().trim();
    codeArt = codeArt.replace(/^0+/, "");

    const designation = r[1] ?? "";
    const nomLatin = r[2] ?? "";
    const prixHTKg = parseFloat(r[6] ?? 0);
    const poidsKg  = parseFloat(r[7] ?? 0);
    const totalLigne = parseFloat(r[8] ?? 0);

    const zoneRaw     = (r[10] ?? "").toString();
    const sousZoneRaw = (r[11] ?? "").toString();
    const engin       = (r[12] ?? "").toString();

    // Zone
    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    // Sous-zone
    const subMatch = sousZoneRaw.match(/\((\d+)\)/);
    let sousZone = "";
    if (subMatch) {
      sousZone = convertFAO(subMatch[1]);
    }

    const fao = zone && sousZone ? `FAO${zone} ${sousZone}` : "";

    // mapping PLU
    const map = afMap[codeArt];
    const plu = map?.plu ?? null;
    const designationInterne = map?.designationInterne ?? designation;

    totalHT += totalLigne;
    totalTTC += totalLigne * 1.1;
    totalKg += poidsKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
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

    console.log("✅ LIGNE:", codeArt, "-> PLU=", plu);
  }

  // update header
  const refA = doc(db, "achats", achatId);
  await updateDoc(refA, {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp(),
  });
}

/**************************************************
 * Convertit FAO numeric → roman (080 → VIII)
 **************************************************/
function convertFAO(n) {
  const map = {
    "27": "VIII",
    "080": "VIII",
    "081": "VIII",
  };
  return map[n] ?? n;
}
