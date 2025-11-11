/**************************************************
 * IMPORT AF_MAP depuis /data/af-map.json
 *  → reconstruit la collection af_map
 *  → ID = fournisseurCode__refFournisseur (clean)
 **************************************************/

import { db } from "../js/firebase-init.js";
import {
  collection,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function importAFMap() {
  try {
    console.log("📦 Import AF_MAP…");

    const res = await fetch("../data/af-map.json");
    if (!res.ok) {
      throw new Error(`Impossible d'accéder à /data/af-map.json → ${res.status}`);
    }

    const items = await res.json();
    const col = collection(db, "af_map");

    let count = 0;

    for (const r of items) {
      let fcode = (r.fournisseurCode || "").toString().trim();
      let ref   = (r.refFournisseur || "").toString().trim();

      // ✅ Nettoyage
      fcode = fcode.replace(/\.0$/, ""); // retire ".0"
      fcode = fcode.replace(/\s+/g, ""); // retire espaces

      ref = ref.replace(/\.0$/, "");     // retire ".0"
      ref = ref.replace(/\s+/g, "");     // retire espaces
      ref = ref.replace(/\//g, "_");     // remplace "/" → "_"

      if (!fcode || !ref) {
        console.warn("⏭️ ligne ignorée : mauvais identifiant", r);
        continue;
      }

      const id = `${fcode}__${ref}`.toUpperCase();

      await setDoc(
        doc(col, id),
        {
          fournisseurCode: fcode,
          fournisseurNom: r.fournisseurNom || "",
          refFournisseur: ref,
          plu: r.plu || "",
          designationInterne: r.designationInterne || "",
          aliasFournisseur: r.aliasFournisseur || "",
          nomLatin: r.nomLatin || "",
          zone: r.zone || "",
          sousZone: r.sousZone || "",
          methode: r.methode || "",
          allergenes: r.allergenes || "",
          engin: r.engin || "",
          updatedAt: new Date()
        },
        { merge: true }
      );

      console.log("✅ import →", id);
      count++;
    }

    alert(`✅ Import AF_MAP terminé → ${count} références`);

  } catch (err) {
    console.error("❌ Erreur import AF_MAP:", err);
    alert("Erreur import AF_MAP : " + err.message);
  }
}

window.importAFMap = importAFMap;
