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

const FOUR_CODE = "81269"; // CRIÉE des Sables

/**************************************************
 * Charger AF_MAP en -> { "81269__105": { ... } }
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
 * SAVE LIGNES
 **************************************************/
async function saveCrieeToFirestore(achatId, rows, afMap) {

  let totalHT = 0;
  let totalTTC = 0;
  let totalKg = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    // Mapping colonnes CRIÉE
    let ref = (r[0] ?? "").toString().trim();
    ref = ref.replace(/^0+/, "");   // remove leading zeros
    ref = ref.replace(/\s+/g, "");  // remove spaces
    ref = ref.replace(/\//g, "_");  // replace slash

    const designation = r[1] ?? "";
    const nomLatin = r[2] ?? "";

    const prixHTKg = parseFloat(r[6] ?? 0);
    const poidsKg  = parseFloat(r[7] ?? 0);
    const totalLigne = parseFloat(r[8] ?? 0);

    // Zone
    const zoneRaw = (r[10] ?? "").toString();
    const subRaw  = (r[11] ?? "").toString();
    const engin   = (r[12] ?? "").toString();

    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = subRaw.match(/\((\d+)\)/);
    let sousZone = "";
    if (subMatch) sousZone = convertFAO(subMatch[1]);

    const fao = zone && sousZone ? `FAO${zone} ${sousZone}` : "";

    // ✅ LOOKUP
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const map = afMap[key];

    const plu = map?.plu || "";
    const designationInterne = map?.designationInterne || designation;

    totalHT += totalLigne;
    totalTTC += totalLigne * 1.1;
    totalKg += poidsKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
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
      updatedAt: serverTimestamp()
    });

    console.log("✅ LIGNE:", ref, "→ PLU:", plu);
  }

  const refA = doc(db, "achats", achatId);
  await updateDoc(refA, {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp()
  });
}
