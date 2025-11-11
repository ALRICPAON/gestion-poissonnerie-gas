/*************************************************
 * IMPORT CRIÉE — Les Sables
 *  - Fichier XLSX local → Firestore
 *  - Mapping via AF_MAP (code article CRIÉE → PLU)
 *  - Majoration CRIÉE : +10% + 0.30 €/kg
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


/*************************************************
 * UI — LISTENER
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
    if (status) status.innerText = `🔎 Mapping AF chargé (${Object.keys(afMap).length} entrées)`;

    await saveCrieeToFirestore(rows, afMap);

    if (status) status.innerText = "✅ Import CRIÉE terminé !";

  } catch (err) {
    console.error("Erreur import :", err);
    alert("Erreur durant l'import : " + err.message);
  }
});



/*************************************************
 * 1) Lecture XLSX brut → tableau
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
 * 2) Charger AF_MAP : code CRIEE → PLU
 *************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "afMap"));
  const map = {};

  snap.forEach((d) => {
    map[d.id] = d.data().plu;      // clé = codeArticleCriee
  });

  return map;
}



/*************************************************
 * 3) Import → Firestore
 *************************************************/
async function saveCrieeToFirestore(rows, afMap) {

  const MAJ_RATE = 1.10;
  const FIX = 0.30;

  const FOURNISSEUR_CODE = "81269";   // CRIÉE Les Sables

  // Création de l'achat
  const achatRef = doc(collection(db, "achats"));
  const lignesColl = collection(achatRef, "lignes");

  let totalHT = 0;
  let totalKg = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;

    /** ✅ mapping CRIÉE (colonnes) */
    const codeArticle = String(r[0]).trim();  // A
    const designation = r[1] || "";           // B
    const latin = r[2] || "";                 // C
    const prix = parseFloat(r[6]) || 0;       // G
    const poids = parseFloat(r[7]) || 0;      // H
    const zoneRaw = r[10] || "";              // K
    const subRaw = r[11] || "";               // L
    const engin = (r[12] || "").trim();       // M

    /** ✅ Mapping code CRIEE → PLU */
    const plu = afMap[codeArticle] ?? null;

    /** ✅ Prix majoré */
    const prixMaj = prix * MAJ_RATE + FIX;
    const total = prixMaj * poids;

    totalHT += total;
    totalKg += poids;

    /** ✅ Zone & sous-zone */
    const zoneNum = extractParen(zoneRaw);   // "27"
    const subNum = extractParen(subRaw);     // "080" → "08"
    const subRoman = toRoman(subNum);        // → "VIII"
    const fao = zoneNum ? `FAO ${zoneNum} ${subRoman}`.trim() : "";

    /** ✅ Écriture ligne */
    await setDoc(doc(lignesColl), {
      fournisseur: FOURNISSEUR_CODE,
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

  /** ✅ Écriture achat */
  await setDoc(achatRef, {
    id: achatRef.id,
    fournisseur: FOURNISSEUR_CODE,
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
  return m[1].padStart(2, "0");   // "080" → "080"
}


function toRoman(subNum = "") {
  const map = {
    "01": "I", "02": "II", "03": "III", "04": "IV", "05": "V", "06": "VI",
    "07": "VII", "08": "VIII", "09": "IX", "10": "X", "11": "XI", "12": "XII"
  };
  const key = String(subNum).padStart(2, "0");
  return map[key] || "";
}
