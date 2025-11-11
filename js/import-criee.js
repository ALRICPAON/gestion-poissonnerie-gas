/*************************************************
 * IMPORT CRIÉE — Les Sables
 * Fichier local (.xlsx/.csv) → Firestore
 *
 * Collections :
 *   afMap/{codeFournisseur} = { plu }
 *   achats/{achatId}
 *   achats/{achatId}/lignes/{lineId}
 *************************************************/

import { read, utils } from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";
import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";


/*************************************************
 * UI — BUTTON CLICK
 *************************************************/
document.getElementById("importCrieeBtn")?.addEventListener("click", async () => {
  const file = document.getElementById("crieeFile")?.files?.[0];
  if (!file) {
    alert("Sélectionne un fichier CRIÉE (.xlsx/.csv)");
    return;
  }

  const status = document.getElementById("importStatus");
  if (status) status.innerText = "📄 Lecture du fichier…";

  try {
    const rows = await readCrieeXLSX(file);
    if (status) status.innerText = `✅ ${rows.length} lignes détectées`;

    const afMap = await loadAFMap();
    if (status) status.innerText = `🔎 Mapping chargé (${Object.keys(afMap).length} entrées)`;

    await saveCrieeToFirestore(rows, afMap);

    if (status) status.innerText = "✅ Import CRIÉE terminé !";

  } catch (err) {
    console.error("Erreur import :", err);
    alert("Erreur durant l'import : " + err.message);
  }
});



/*************************************************
 * 1) Lecture fichier XLSX → lignes brutes
 *************************************************/
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



/*************************************************
 * 2) Charger AF_MAP depuis Firestore
 *************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "afMap"));
  const map = {};

  snap.forEach((d) => {
    map[d.id] = d.data().plu;     // key = code fournisseur
  });

  return map;
}



/*************************************************
 * 3) Enregistrer les lignes dans Firestore
 *************************************************/
async function saveCrieeToFirestore(rows, afMap) {

  // Majoration CRIÉE
  const MAJ_RATE = 1.10;
  const FIX = 0.30;

  // Création achat
  const achatRef = doc(collection(db, "achats"));
  const lignesColl = collection(achatRef, "lignes");

  let totalHT = 0;
  let totalKg = 0;

  // Boucle lignes
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;   // ignore lignes vides

    const codeF = String(r[0]).trim();
    const designation = r[1] || "";
    const latin = r[2] || "";
    const prix = parseFloat(r[8]) || 0;
    const poids = parseFloat(r[9]) || 0;
    const fao = r[12] || "";
    const sub = r[13] || "";
    const engin = r[14] || "";

    const plu = afMap[codeF] || null;

    // Majoration CRIÉE
    const prixMaj = prix * MAJ_RATE + FIX;
    const total = prixMaj * poids;

    totalHT += total;
    totalKg += poids;

    // Write line
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

  // Écriture doc achat
  await setDoc(achatRef, {
    id: achatRef.id,
    fournisseur: "criee_sables",
    createdAt: Timestamp.now(),
    totalHT,
    totalKg,
  });

  return true;
}



/*************************************************
 * (Option) Convertit sous-zone → chiffres romains
 *************************************************/
function toRoman(sub) {
  const map = {
    "01":"I","02":"II","03":"III","04":"IV","05":"V","06":"VI","07":"VII","08":"VIII",
    "09":"IX","10":"X","11":"XI","12":"XII"
  };
  return map[String(sub).padStart(2,"0")] || sub;
}
