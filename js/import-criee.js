/*************************************************
 * IMPORT CRIÉE — Les Sables
 *  - Fichier XLSX local → Firestore
 *  - Mapping via AF_MAP (af_map/{fournisseur__codeArticle})
 *  - Majoration CRIÉE : prix * 1.10 + 0.30 €/kg
 *  - Extraction zone/sous-zone → FAO 27 VIII
 *************************************************/

import { read, utils } from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";
import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";


/*************************************************
 * UI — BOUTON
 *************************************************/
document.getElementById("importCrieeBtn")?.addEventListener("click", async () => {
  const file = document.getElementById("crieeFile")?.files?.[0];
  if (!file) {
    alert("Sélectionne un fichier CRIÉE (.xlsx/.csv)");
    return;
  }

  const status = document.getElementById("importStatus");
  if (status) status.innerText = "📄 Lecture fichier…";

  try {
    const rows = await readCrieeXLSX(file);
    if (status) status.innerText = `✅ ${rows.length} lignes détectées`;

    const afMap = await loadAFMap("81269");      // ✅ mapping PLU
    if (status) status.innerText = `🔎 Mapping AF : ${Object.keys(afMap).length} références`;

    const fournisseur = await loadFournisseur("81269");  // ✅ fournisseur
    if (status) status.innerText = `✅ Fournisseur : ${fournisseur.nom}`;

    await saveCrieeToFirestore(rows, afMap, fournisseur);

    if (status) status.innerText = "✅ Import CRIÉE terminé !";

  } catch (err) {
    console.error("Erreur import :", err);
    alert("Erreur durant l'import : " + err.message);
  }
});



/*************************************************
 * 1) Lecture XLSX → rows[][]
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
 * 2) Charger AF_MAP
 *    af_map/{fournisseur__codeArticle}  (ID)
 *************************************************/
async function loadAFMap(fournisseurCode) {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};

  snap.forEach((d) => {
    const id = d.id;               // ex: "81269__36130"
    const parts = id.split("__");
    if (parts.length !== 2) return;

    const f = parts[0];            // "81269"
    const codeArticle = parts[1];  // "36130"

    if (f !== fournisseurCode) return;

    const plu = d.data().plu || null;
    map[codeArticle] = plu;
  });

  console.log("AF MAP =", map);
  return map;
}



/*************************************************
 * 3) Charger Fournisseur
 *************************************************/
async function loadFournisseur(code) {
  const ref = doc(db, "fournisseurs", code);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return {
      code,
      nom: ""
    };
  }
  return {
    code,
    nom: snap.data().nom || ""
  };
}



/*************************************************
 * 4) Import → Firestore
 *************************************************/
async function saveCrieeToFirestore(rows, afMap, fournisseur) {

  const MAJ_RATE = 1.10;
  const FIX = 0.30;

  const achatRef = doc(collection(db, "achats"));
  const lignesColl = collection(achatRef, "lignes");

  let totalHT = 0;
  let totalKg = 0;

  // Ligne 0 = entêtes → on commence à 1
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;

    /** ✅ mapping CRIÉE */
    const codeArticle = String(r[0]).trim();   // Col A
    const designation = r[1] || "";            // Col B
    const latin = r[2] || "";                  // Col C
    const prix = parseFloat(r[6]) || 0;        // Col G
    const poids = parseFloat(r[7]) || 0;       // Col H
    const zoneRaw = r[10] || "";               // Col K
    const subRaw = r[11] || "";                // Col L
    const engin = (r[12] || "").trim();        // Col M

    /** ✅ mapping PLU */
    const plu = afMap[codeArticle] ?? null;

    /** ✅ prix majoré */
    const prixMaj = prix * MAJ_RATE + FIX;
    const total = prixMaj * poids;

    totalHT += total;
    totalKg += poids;

    /** ✅ extraction zone/sous-zone */
    const zoneNum = extractParen(zoneRaw);   // "27"
    const subNum = extractParen(subRaw);     // "080"
    const subRoman = toRoman(subNum);        // → "VIII"
    const fao = zoneNum ? `FAO ${zoneNum} ${subRoman}`.trim() : "";

    /** ✅ write line */
    await setDoc(doc(lignesColl), {
      fournisseurCode: fournisseur.code,
      fournisseurNom: fournisseur.nom,
      codeArticle,
      plu,
      designation,
      latin,
      poidsKg: poids,
      prixHTKg: prixMaj,
      totalHT: total,
      fao,
      zone: zoneNum,
      sousZone: subRoman,
      engin,
      createdAt: Timestamp.now(),
    });
  }

  /** ✅ DOC achat (header) */
  await setDoc(achatRef, {
    id: achatRef.id,
    fournisseurCode: fournisseur.code,
    fournisseurNom: fournisseur.nom,
    createdAt: Timestamp.now(),
    totalHT,
    totalKg,
  });

  return true;
}



/*************************************************
 * HELPERS
 *************************************************/

function extractParen(txt = "") {
  const m = String(txt).match(/\((\d+)\)/);
  if (!m) return "";
  return m[1].padStart(2, "0");
}

function toRoman(subNum = "") {
  const map = {
    "01": "I", "02": "II", "03": "III", "04": "IV", "05": "V", "06": "VI",
    "07": "VII", "08": "VIII", "09": "IX", "10": "X", "11": "XI", "12": "XII"
  };
  return map[String(subNum).padStart(2, "0")] || "";
}
