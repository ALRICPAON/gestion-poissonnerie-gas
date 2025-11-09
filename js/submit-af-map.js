import { db } from "../js/firebase-init.js";
import { collection, setDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { loadAFMap } from "./load-af-map.js";

const col = collection(db, "af_map");

// petits helpers
const nz = v => (v == null ? "" : String(v).trim());
const cleanNumStr = v => {
  const s = nz(v);
  return /^\d+\.0$/.test(s) ? s.replace(/\.0$/, "") : s;
};

export async function submitAFMap() {
  const fournisseurCode = cleanNumStr(document.getElementById("add-fournisseurCode").value);
  const fournisseurNom  = nz(document.getElementById("add-fournisseurNom").value);
  const refFournisseur  = cleanNumStr(document.getElementById("add-refFournisseur").value);
  const plu             = cleanNumStr(document.getElementById("add-plu").value);
  const designation     = nz(document.getElementById("add-designationInterne").value);

  if (!fournisseurCode || !refFournisseur) {
    alert("Code fournisseur + Référence fournisseur sont obligatoires.");
    return;
  }

  const id = `${fournisseurCode}__${refFournisseur}`.toUpperCase();

  await setDoc(doc(col, id), {
    fournisseurCode,
    fournisseurNom,
    refFournisseur,
    plu,
    designationInterne: designation,
    updatedAt: new Date()
  }, { merge:true });

  // reset petit confort
  document.getElementById("add-fournisseurCode").value = "";
  document.getElementById("add-fournisseurNom").value  = "";
  document.getElementById("add-refFournisseur").value  = "";
  document.getElementById("add-plu").value             = "";
  document.getElementById("add-designationInterne").value = "";

  hideAddForm();
  loadAFMap();
}

// garder les handlers visibles pour le HTML inline
window.submitAFMap = submitAFMap;

window.showAddForm = () => {
  document.getElementById("addForm").style.display = "block";
};
window.hideAddForm = () => {
  document.getElementById("addForm").style.display = "none";
};
