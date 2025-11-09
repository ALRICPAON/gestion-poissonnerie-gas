import { db } from "../js/firebase-init.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { loadAFMap } from "./load-af-map.js";

export async function editAFMap(id) {
  const ref = doc(db, "af_map", id);
  const snap = await getDoc(ref);
  const r = snap.data();

  const newPlu = prompt("PLU interne :", r.plu || "");
  const newDesignation = prompt("Désignation interne :", r.designationInterne || "");

  await updateDoc(ref, {
    plu: newPlu,
    designationInterne: newDesignation,
    updatedAt: new Date()
  });

  loadAFMap();
}

window.editAFMap = editAFMap;
