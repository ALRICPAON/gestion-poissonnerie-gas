import { db } from "../js/firebase-init.js";
import { collection, setDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { loadAFMap } from "./load-af-map.js";

const col = collection(db, "af_map");

// helpers nettoyage
const nz = v => (v == null ? "" : String(v).trim());
const cleanNumStr = v => {
  const s = nz(v);
  return /^\d+\.0$/.test(s) ? s.replace(/\.0$/, "") : s;
};

function bindForm() {
  const form = document.getElementById("af-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fournisseurCode = cleanNumStr(form.fournisseurCode.value);
    const fournisseurNom  = nz(form.fournisseurNom.value);
    const refFournisseur  = cleanNumStr(form.refFournisseur.value);
    const plu             = cleanNumStr(form.plu.value);
    const designation     = nz(form.designationInterne.value);

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
    }, { merge: true });

    form.reset();
    loadAFMap();
  });
}

window.addEventListener('DOMContentLoaded', bindForm);
