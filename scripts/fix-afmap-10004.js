/**************************************************
 * 🔧 Corrige les refFournisseur pour le fournisseur 10004
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  getDocs,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function fixAFMapZeros10004() {
  const snap = await getDocs(collection(db, "af_map"));
  let count = 0;

  for (const d of snap.docs) {
    const data = d.data();

    // On cible uniquement le fournisseur 10004 (Royale Marée)
    if (data.fournisseurCode !== "10004") continue;

    const ref = data.refFournisseur;
    if (!ref) continue;

    const refStr = ref.toString().trim();

    // Ignore si déjà correct
    if (!/^[0-9]+$/.test(refStr) || refStr.startsWith("0")) continue;

    // Ajoute des zéros devant si longueur < 5 (à ajuster selon ton format)
    if (refStr.length < 5) {
      const newRef = refStr.padStart(5, "0");

      console.log(`🔄 ${data.fournisseurNom || "?"} : ${refStr} → ${newRef}`);
      await updateDoc(doc(db, "af_map", d.id), {
        refFournisseur: newRef
      });
      count++;
    }
  }

  console.log(`✅ ${count} références corrigées pour le fournisseur 10004`);
}

fixAFMapZeros10004();
