/**************************************************
 * Script ponctuel — nettoyer af_map
 * Supprime les ".0" dans les PLU
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

export async function fixAFMapPLU() {

  const snap = await getDocs(collection(db, "af_map"));
  let count = 0;

  for (const d of snap.docs) {
    const data = d.data();
    let { plu } = data;

    if (!plu) continue;
    if (typeof plu !== "string") plu = plu.toString();

    // ✅ Si PLU finit par ".0" → on coupe
    if (plu.endsWith(".0")) {
      const clean = plu.replace(/\.0$/, "");

      await updateDoc(doc(db, "af_map", d.id), {
        plu: clean
      });

      console.log(`✅ FIX ${plu} → ${clean}`);
      count++;
    }
  }

  alert(`✅ Correction terminée : ${count} PLU fixées`);
}
