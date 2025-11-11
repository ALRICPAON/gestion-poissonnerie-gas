/**************************************************
 * Script ponctuel — nettoyer af_map
 * Supprime les ".0" dans les PLU (ex: "3063.0" → "3063")
 *
 * Usage :
 * 1) Ouvrir la page qui charge firebase-init.js
 * 2) Ouvrir la console Chrome
 * 3) exécuter :  fixAFMapPLU()
 **************************************************/

import { db } from "../js/firebase-init.js";
import {
  collection,
  getDocs,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

export async function fixAFMapPLU() {
  console.log("🔎 Début correction PLU…");

  const snap = await getDocs(collection(db, "af_map"));
  let count = 0;

  for (const d of snap.docs) {
    const data = d.data();
    let { plu } = data;

    if (!plu) continue;

    // Forcer string
    if (typeof plu !== "string") plu = plu.toString();

    // ✅ détecte les .0
    if (plu.endsWith(".0")) {
      const clean = plu.replace(/\.0$/, "");

      await updateDoc(doc(db, "af_map", d.id), {
        plu: clean
      });

      console.log(`✅ FIX ${plu} → ${clean}`);
      count++;
    }
  }

  console.log(`✅ Correction terminée : ${count} PLU fixées`);
  alert(`✅ Correction terminée : ${count} PLU fixées`);
}
