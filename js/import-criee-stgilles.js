/**************************************************
 * IMPORT CRIÉE ST-GILLES (FOUR_CODE = 81268)
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, getDoc, getDocs, doc,
  serverTimestamp, updateDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const FOUR_CODE = "81268"; // Criée St-Gilles

/******** AF_MAP → { "81268__33320": { plu, designationInterne, ... } } */
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => { map[d.id] = d.data(); });
  return map;
}

/******** Fournisseur */
async function loadSupplierInfo() {
  const ref = doc(db, "fournisseurs", FOUR_CODE);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { code: FOUR_CODE, nom: "Criée St-Gilles" };
  return snap.data();
}

/******** XLSX reader (SheetJS) */
function readWorkbookAsync(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        resolve(wb);
      } catch (err) { reject(err); }
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

/******** Header Achat (→ Timestamp, pas string) */
async function createAchatHeader(supplier) {
  const colAchats = collection(db, "achats");
  const now = new Date();
  const ref = await addDoc(colAchats, {
    date: Timestamp.fromDate(now),             // ✅ Timestamp
    fournisseurCode: supplier.code || FOUR_CODE,
    fournisseurNom: supplier.nom || "Criée St-Gilles",
    designationFournisseur: "Import Criée St-Gilles",
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/******** FAO num → roman (ex: "080" → "VIII") */
function convertFAO(n) {
  const map = { "27": "VIII", "080": "VIII", "081": "VIII" };
  return map[n] ?? n;
}

/******** Petite util */
const nz = v => (v == null ? "" : String(v).trim());

/******** Save lignes */
async function saveCrieeToFirestore(achatId, rows, afMap) {
  let totalHT = 0, totalTTC = 0, totalKg = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    // A ref fournisseur
    let ref = nz(r[0]).replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    // B designation, C nom latin
    const designation = nz(r[1]);
    const nomLatin    = nz(r[2]);

    // G prix/kg, H poids total, I total HT
    const prixKg       = parseFloat(String(r[6]).replace(",", ".")) || 0;
    const poidsTotalKg = parseFloat(String(r[7]).replace(",", ".")) || 0;
    const montantHT    = parseFloat(String(r[8]).replace(",", ".")) || 0;

    // K zone "(27)", L sous-zone "(080)", M engin
    const zoneRaw = nz(r[10]);
    const subRaw  = nz(r[11]);
    const engin   = nz(r[12]);

    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = subRaw.match(/\((\d+)\)/);
    const sousZone = subMatch ? convertFAO(subMatch[1]) : "";

    const fao = zone && sousZone ? `FAO${zone} ${sousZone}` : "";

    // AF_MAP lookup
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const M = afMap[key] || null;

    let plu = M?.plu ? String(M.plu) : "";
    plu = plu.replace(/\.0$/, ""); // Excel floats → string
    const designationInterne = M?.designationInterne || designation;
    const allergenes = M?.allergenes || "";

    totalHT  += montantHT;
    totalTTC += montantHT;     // TVA non gérée ici
    totalKg  += poidsTotalKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
      fournisseurRef: ref,

      // 👍 noms attendus par achat-detail.js
      plu,
      designation,
      designationInterne,
      nomLatin,

      zone, sousZone, engin, allergenes, fao,

      // set CRIÉE fields dans les bons noms:
      poidsTotalKg,
      prixKg,
      montantHT,
      montantTTC: montantHT,

      // champs manuels non utilisés ici
      colis: 0,
      poidsColisKg: 0,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    console.log("LIGNE", ref, "→ PLU:", plu, "|", designation, "| kg:", poidsTotalKg, "| €/kg:", prixKg, "| HT:", montantHT);
  }

  // maj header
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp(),
  });
}

/******** Exportée pour la page Achats (menu déroulant) */
export async function importCrieeStGilles(file) {
  // lecture + import
  const [afMap, supplier] = await Promise.all([loadAFMap(), loadSupplierInfo()]);
  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const achatId = await createAchatHeader(supplier);
  await saveCrieeToFirestore(achatId, rows, afMap);
}

