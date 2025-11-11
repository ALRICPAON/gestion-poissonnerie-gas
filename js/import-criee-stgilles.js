/**************************************************
 * IMPORT CRIÉE ST-GILLES  (FOUR_CODE = 81268)
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

const FOUR_CODE = "81268";   // ✅ ST-GILLES

/**************************************************
 * AF_MAP
 **************************************************/
async function loadAFMap() {
  console.log("📥 LOAD AF MAP…");
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => {
    map[d.id] = d.data();
  });
  console.log("✅ AF MAP loaded:", Object.keys(map).length, "items");
  return map;
}

/**************************************************
 * Fournisseur
 **************************************************/
async function loadSupplierInfo() {
  const ref = doc(db, "fournisseurs", FOUR_CODE);
  const s = await getDoc(ref);
  if (!s.exists()) return { code: FOUR_CODE, nom: "CRIÉE ST-GILLES" };
  return s.data();
}

/**************************************************
 * XLSX
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
 * CREATE achat header
 **************************************************/
async function createAchatHeader(supplier) {
  const colAchats = collection(db, "achats");
  const ref = await addDoc(colAchats, {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code || FOUR_CODE,
    fournisseurNom: supplier.nom || "CRIÉE ST-GILLES",

    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,

    statut: "new",
    type: "BL",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  console.log("✅ Achat header créé:", ref.id);
  return ref.id;
}

/**************************************************
 * Conversion FAO
 **************************************************/
function convertFAO(n) {
  const map = {
    "27": "VIII",
    "081": "VIII",
    "080": "VIII"
  };
  return map[n] ?? n;
}

/**************************************************
 * SAVE LIGNES
 **************************************************/
async function saveCrieeToFirestore(achatId, rows, afMap) {

  let totalHT = 0;
  let totalKg = 0;

  // ✅ Ligne 0 = entêtes
  for (let i = 1; i < rows.length; i++) {

    const r = rows[i];
    if (!r || !r.length) continue;

    // ---------------- REF FOURNISSEUR
    let ref = (r[0] ?? "").toString().trim();
    ref = ref.replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    // ---------------- DONNÉES BRUTES
    const designation = r[1] ?? "";
    const nomLatin    = r[2] ?? "";

    const prixHTKg    = parseFloat(r[6] ?? 0);     // ✅ prix/kg
    const poidsKg     = parseFloat(r[7] ?? 0);     // ✅ poids total
    const montantHT   = parseFloat(r[8] ?? 0);     // ✅ montant HT

    // ---------------- FAO
    const zoneRaw = (r[10] ?? "").toString();
    const subRaw  = (r[11] ?? "").toString();
    const engin   = (r[12] ?? "").toString();

    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = subRaw.match(/\((\d+)\)/);
    let sousZone = "";
    if (subMatch) sousZone = convertFAO(subMatch[1]);

    const fao = zone && sousZone ? `FAO${zone} ${sousZone}` : "";

    // ---------------- AF_MAP lookup
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const map = afMap[key];

    const plu = map?.plu || "";
    const designationInterne = map?.designationInterne || designation;
    const allergenes = map?.allergenes || "";

    // ---------------- ACCUMULE
    totalHT += montantHT;
    totalKg += poidsKg;

    // ---------------- FIRESTORE LIGNE
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
      fao,

      poidsKg,
      prixHTKg,
      totalHT: montantHT,

      // champs manuels laissés à 0
      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg: poidsKg,
      prixKg: prixHTKg,

      montantHT,
      montantTTC: montantHT,

      received: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log("✅ LIGNE:", ref, "→ PLU:", plu);
  }

  // ---------------- UPDATE HEADER
  const achatRef = doc(db, "achats", achatId);
  await updateDoc(achatRef, {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });
}

/**************************************************
 * MAIN EXPORT
 **************************************************/
export async function importCrieeStGilles(file) {
  const afMap = await loadAFMap();
  const supplier = await loadSupplierInfo();

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);
  await saveCrieeToFirestore(achatId, rows, afMap);

  alert("✅ Import CRIÉE ST-GILLES terminé");
  location.reload();
}
