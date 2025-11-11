/**************************************************
 * IMPORT CRIÉE DES SABLES
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

const FOUR_CODE = "81268"; // CRIÉE de saint gilles croix de vie

/**************************************************
 * Charger AF_MAP en -> { "81268__105": { ... } }
 **************************************************/
async function loadAFMap() {
  console.log("📥 LOAD AF MAP…");
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};

  snap.forEach(d => {
    map[d.id] = d.data();   // ✅ simple lookup
  });

  console.log("✅ AF MAP loaded:", Object.keys(map).length, "items");
  return map;
}

/**************************************************
 * Charger la fiche fournisseur
 **************************************************/
async function loadSupplierInfo() {
  const ref = doc(db, "fournisseurs", FOUR_CODE);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { code: FOUR_CODE, nom: "CRIÉE" };
  return snap.data();
}

/**************************************************
 * LECTURE XLSX (SheetJS)
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
 * Handler bouton
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

    // Charger mapping + fournisseur
    const afMap = await loadAFMap();
    const supplier = await loadSupplierInfo();

    divStatus.textContent = "Lecture fichier…";

    const wb = await readWorkbookAsync(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const achatId = await createAchatHeader(supplier);

    divStatus.textContent = "Import des lignes…";

    await saveCrieeToFirestore(achatId, rows, afMap);

    divStatus.textContent = "✅ Terminé";

    alert("✅ Import CRIÉE terminé");
    location.reload();

  } catch (e) {
    console.error("❌ Erreur import CRIÉE:", e);
    alert("Erreur import CRIÉE : " + e.message);
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
    fournisseurNom: supplier.nom || "CRIÉE des Sables",
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
 * Conversion FAO (080 → VIII)
 **************************************************/
function convertFAO(n) {
  const map = {
    "27": "VIII",
    "080": "VIII",
    "081": "VIII"
  };
  return map[n] ?? n;
}

/**************************************************
 * SAVE LIGNES — version alignée achat-detail.js
 **************************************************/
async function saveCrieeToFirestore(achatId, rows, afMap) {

  let totalHT = 0;
  let totalTTC = 0;
  let totalKg = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    /** ✅ Extraction colonnes CRIÉE **/
    let ref = (r[0] ?? "").toString().trim();
    ref = ref.replace(/^0+/, "");   // strip 0
    ref = ref.replace(/\s+/g, "");  // strip spaces
    ref = ref.replace(/\//g, "_");  // replace slash

    const designation = r[1] ?? "";
    const nomLatinCR  = r[2] ?? "";

    const prixHTKgCR = parseFloat(r[6] ?? 0);
    const poidsKgCR  = parseFloat(r[7] ?? 0);
    const totalLigne = parseFloat(r[8] ?? 0);

    // Zone
    const zoneRaw = (r[10] ?? "").toString();
    const subRaw  = (r[11] ?? "").toString();
    const enginCR = (r[12] ?? "").toString();

    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = subRaw.match(/\((\d+)\)/);
    let sousZone = subMatch ? convertFAO(subMatch[1]) : "";

    /** ✅ Lookup AF_MAP **/
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const map = afMap[key];

    const plu = map?.plu || "";
    const designationInterne = map?.designationInterne || designation;
    const nomLatin = map?.nomLatin || nomLatinCR || "";
    const engin    = map?.engin    || enginCR || "";
    const allergenes = map?.allergenes || "";

    /** ✅ Montants **/
    totalHT  += totalLigne;
    totalTTC += totalLigne * 1.1;
    totalKg  += poidsKgCR;

    /** ✅ ÉCRITURE Firestore (format UI achat-detail.js) **/
    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
      plu,
      designation: designationInterne,
      nomLatin,
      zone,
      sousZone,
      engin,
      allergenes,

      // ✅ Champs UI achats
      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg: poidsKgCR,
      prixKg: prixHTKgCR,
      montantHT: totalLigne,

      // Optionnel
      designationFournisseur: designation,
      fournisseurRef: ref,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log("✅ LIGNE importée:", ref, "→ PLU:", plu);
  }

  /** ✅ Update achat header **/
  const achatRef = doc(db, "achats", achatId);
  await updateDoc(achatRef, {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp()
  });
}
