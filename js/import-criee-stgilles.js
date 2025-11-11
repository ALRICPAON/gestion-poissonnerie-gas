/**************************************************
 * IMPORT CRIÉE – ST GILLES
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

const FOUR_CODE = "81268";

/**************************************************
 * LOAD AF_MAP
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

/**************************************************
 * LOAD supplier
 **************************************************/
async function loadSupplierInfo() {
  const ref = doc(db, "fournisseurs", FOUR_CODE);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { code: FOUR_CODE, nom: "CRIÉE" };
  return snap.data();
}

/**************************************************
 * XLSX reader
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
 * Create achat header
 **************************************************/
async function createAchatHeader(supplier) {
  const colAchats = collection(db, "achats");
  const docRef = await addDoc(colAchats, {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code || FOUR_CODE,
    fournisseurNom: supplier.nom || "CRIÉE",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    statut: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    type: "BL"
  });
  return docRef.id;
}

/**************************************************
 * Helper convert FAO
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

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    // ref
    let ref = (r[0] ?? "").toString().trim();
    ref = ref.replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    // raw columns
    const designation   = r[1] ?? "";
    const nomLatin      = r[2] ?? "";
    const prixHTKg      = parseFloat(r[6] ?? 0);
const poidsKg       = parseFloat(r[7] ?? 0);
const totalLigneHT  = parseFloat(r[8] ?? 0);


    // zone / sousZone / engin
    const zoneRaw = (r[10] ?? "").toString();
    const subRaw  = (r[11] ?? "").toString();
    const engin   = (r[12] ?? "").toString();

    const zoneMatch = zoneRaw.match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = subRaw.match(/\((\d+)\)/);
    let sousZone = "";
    if (subMatch) sousZone = convertFAO(subMatch[1]);

    const fao = zone && sousZone ? `FAO${zone} ${sousZone}` : "";

    // lookup AF_MAP
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const map = afMap[key];

    const plu = map?.plu || "";
    const designationInterne = map?.designationInterne || designation;
    const allergenes = map?.allergenes || "";

    totalHT  += totalLigneHT;
    totalTTC += totalLigneHT;
    totalKg  += poidsKg;

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
      totalHT: totalLigneHT,
      montantTTC: totalLigneHT,

      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg: poidsKg,

      received: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log("✅ LIGNE:", ref, "→ PLU:", plu);
  }

  // update header
  const refA = doc(db, "achats", achatId);
  await updateDoc(refA, {
    montantHT: totalHT,
    montantTTC: totalTTC,
    totalKg,
    updatedAt: serverTimestamp()
  });
}

/**************************************************
 * EXPORT
 **************************************************/
export async function importCrieeStGilles(file) {
  const afMap = await loadAFMap();
  const supplier = await loadSupplierInfo();
  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);
  await saveCrieeToFirestore(achatId, rows, afMap);

  return achatId;
}
