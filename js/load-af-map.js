import { db } from "../js/firebase-init.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { loadAFMap } from "./load-af-map.js";

export async function editAFMap(id) {
  const ref = doc(db, "af_map", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const r = snap.data();

  const newPlu  = prompt("PLU interne :", r.plu || "") ?? r.plu || "";
  const newDesi = prompt("Désignation interne :", r.designationInterne || "") ?? r.designationInterne || "";

  await updateDoc(ref, {
    plu: newPlu.trim(),
    designationInterne: newDesi.trim(),
    updatedAt: new Date()
  });

  loadAFMap();
}

window.editAFMap = editAFMap;
