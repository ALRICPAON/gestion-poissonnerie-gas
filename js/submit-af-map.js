import { db } from "../js/firebase-init.js";
import { collection, setDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { loadAFMap } from "./load-af-map.js";

const col = collection(db, "af_map");

export async function submitAFMap() {
  const a = v => document.getElementById(v).value.trim();

  const fournisseurCode = a("add-fournisseurCode");
  const refFournisseur  = a("add-refFournisseur");

  if (!fournisseurCode || !refFournisseur) {
    alert("Code fournisseur + Référence obligatoires");
    return;
  }

  const id = `${fournisseurCode}__${refFournisseur}`.toUpperCase();

  await setDoc(doc(col, id), {
    fournisseurCode,
    fournisseurNom: a("add-fournisseurNom"),
    refFournisseur,
    plu: a("add-plu"),
    designationInterne: a("add-designationInterne"),
    updatedAt: new Date()
  }, { merge:true });

  hideAddForm();
  loadAFMap();
}

window.showAddForm = () => {
  document.getElementById("addForm").style.display = "block";
};

window.hideAddForm = () => {
  document.getElementById("addForm").style.display = "none";
};
