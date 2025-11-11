/**************************************************
 * IMPORT CRIÉE ST-GILLES (81268)
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
 * AF MAP
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

/**************************************************
 * Fournisseur
 **************************************************/
async function loadSupplierInfo() {
  const snap = await getDoc(doc(db,"fournisseurs",FOUR_CODE));
  return snap.exists() ? snap.data() : { code:FOUR_CODE, nom:"CRIÉE ST-GILLES" };
}

/**************************************************
 * XLSX → workbook
 **************************************************/
function readWorkbookAsync(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = e=>{
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result),{type:"array"});
        resolve(wb);
      } catch(e){ reject(e); }
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

/**************************************************
 * HEADER ACHAT
 **************************************************/
async function createAchatHeader(supplier){
  const ref = await addDoc(collection(db,"achats"),{
    date: new Date().toISOString().slice(0,10),
    fournisseurCode: supplier.code,
    fournisseurNom:  supplier.nom,
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    statut: "new",
    type:   "BL",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**************************************************
 * SAVE LIGNES
 **************************************************/
async function saveCrieeToFirestore(achatId, rows, afMap){

  let totalHT = 0;
  let totalKg = 0;

  for(let i=1;i<rows.length;i++){

    const r = rows[i];
    if(!r?.length) continue;

    // REF FOURN
    let ref = (r[0] ?? "").toString().trim()
      .replace(/^0+/,"")
      .replace(/\s+/g,"")
      .replace(/\//g,"_");

    // DONNÉES BRUTES
    const designation = r[1] ?? "";
    const nomLatin = r[2] ?? "";

    // ✅ ICI LES 3 VALEURS CRITIQUES
    const prixHTKg  = parseFloat(r[6] ?? 0);   // ← colonne validée
    const poidsKg   = parseFloat(r[7] ?? 0);
    const montantHT = parseFloat(r[8] ?? 0);

    // FAO
    const zoneMatch = (r[10] ?? "").toString().match(/\((\d+)\)/);
    const zone = zoneMatch ? zoneMatch[1] : "";

    const subMatch = (r[11] ?? "").toString().match(/\((\d+)\)/);
    const sousZone = subMatch ? subMatch[1] : "";

    const fao = zone && sousZone ? `FAO${zone} ${sousZone}` : "";
    const engin = r[12] ?? "";

    // AF MAP
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const M = afMap[key];

    let plu = (M?.plu ?? "").toString();
    if (plu.endsWith(".0")) plu = plu.slice(0,-2);   // ✅ supprime .0

    const designationInterne = M?.designationInterne || designation;
    const allergenes = M?.allergenes || "";

    totalHT += montantHT;
    totalKg += poidsKg;

    await addDoc(collection(db,"achats",achatId,"lignes"),{
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
      prixKg: prixHTKg,     // ← affichage OK
      montantHT,
      montantTTC: montantHT,

      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg: poidsKg,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db,"achats",achatId),{
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp(),
  });
}

/**************************************************
 * ENTRY POINT
 **************************************************/
export async function importCrieeStGilles(file){
  const afMap = await loadAFMap();
  const supplier = await loadSupplierInfo();

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet,{header:1});

  const achatId = await createAchatHeader(supplier);
  await saveCrieeToFirestore(achatId,rows,afMap);

  alert("✅ Import Criée ST-GILLES OK");
  location.reload();
}
