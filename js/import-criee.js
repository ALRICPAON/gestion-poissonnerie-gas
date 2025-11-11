/*************************************************
 * IMPORT CRIÉE — Les Sables
 *************************************************/

import { read, utils } from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";
import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";


document.getElementById("importCrieeBtn")?.addEventListener("click", async () => {
  const file = document.getElementById("crieeFile")?.files?.[0];
  if (!file) {
    alert("Sélectionne un fichier CRIÉE (.xlsx/.csv)");
    return;
  }

  const status = document.getElementById("importStatus");
  if (status) status.innerText = "📄 Lecture du fichier…";

  console.log("DB =", db);

  try {
    const rows = await readCrieeXLSX(file);
    if (status) status.innerText = `✅ ${rows.length} lignes détectées`;

    const afMap = await loadAFMap();
    if (status) status.innerText = `🔎 Mapping chargé (${Object.keys(afMap).length})`;

    await saveCrieeToFirestore(rows, afMap);

    if (status) status.innerText = "✅ Import CRIÉE terminé !";

  } catch (err) {
    console.error("Erreur import :", err);
    alert("Erreur durant l'import : " + err.message);
  }
});


// =========================================
// 1) Lecture fichier
// =========================================
async function readCrieeXLSX(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json(sheet, { header: 1 });
      resolve(rows);
    };

    reader.readAsArrayBuffer(file);
  });
}



// =========================================
// 2) Charger AF MAP
// =========================================
async function loadAFMap() {
  const snap = await getDocs(collection(db, "afMap"));
  const map = {};

  snap.forEach((d) => {
    map[d.id] = d.data().plu; 
  });

  return map;
}



// =========================================
// 3) Firestore save
// =========================================
async function saveCrieeToFirestore(rows, afMap) {

  const MAJ_RATE = 1.10;
  const FIX = 0.30;

  const achatRef = doc(collection(db, "achats"));
  const lignesColl = collection(achatRef, "lignes");

  let totalHT = 0;
  let totalKg = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;

    const codeF = String(r[0]).trim();
    const designation = r[1] || "";
    const latin = r[2] || "";
    const prix = parseFloat(r[8]) || 0;
    const poids = parseFloat(r[9]) || 0;
    const fao = r[12] || "";
    const sub = r[13] || "";
    const engin = r[14] || "";

    const plu = afMap[codeF] || null;

    const prixMaj = prix * MAJ_RATE + FIX;
    const total = prixMaj * poids;

    totalHT += total;
    totalKg += poids;

    await setDoc(doc(lignesColl), {
      codeFournisseur: codeF,
      plu,
      designation,
      latin,
      poidsKg: poids,
      prixHTKg: prixMaj,
      totalHT: total,
      fao,
      sousZone: sub,
      engin,
      createdAt: Timestamp.now(),
    });
  }

  await setDoc(achatRef, {
    id: achatRef.id,
    fournisseur: "criee_sables",
    createdAt: Timestamp.now(),
    totalHT,
    totalKg,
  });

  return true;
}
