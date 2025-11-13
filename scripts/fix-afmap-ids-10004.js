/**************************************************
 * 🧱 Corrige les IDs Firestore pour le fournisseur 10004
 * Exemple : "10004__1683" → "10004__01683"
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function fixAFMapDocIds10004() {
  const snap = await getDocs(collection(db, "af_map"));
  let moved = 0;

  for (const d of snap.docs) {
    const data = d.data();

    // On cible uniquement le fournisseur 10004
    if (data.fournisseurCode !== "10004") continue;

    const oldId = d.id;
    const ref = data.refFournisseur?.toString().trim();
    if (!ref || !/^[0-9]+$/.test(ref)) continue;

    const newRef = ref.padStart(5, "0");
    const newId = `${data.fournisseurCode}__${newRef}`;

    // Si l'ID est déjà bon, on ignore
    if (oldId === newId) continue;

    console.log(`🔁 ${oldId} → ${newId}`);

    // 1️⃣ Créer le nouveau doc
    await setDoc(doc(db, "af_map", newId), data);

    // 2️⃣ Supprimer l'ancien doc
    await deleteDoc(doc(db, "af_map", oldId));

    moved++;
  }

  console.log(`✅ ${moved} documents renommés pour fournisseur 10004`);
}

fixAFMapDocIds10004();
