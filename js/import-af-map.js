import { db } from "../js/firebase-init.js";
import { collection, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function importAFMap() {
  const res = await fetch("../data/af-map.json");
  const items = await res.json();

  const col = collection(db, "af_map");

  for (const r of items) {
    const id = `${r.fournisseurCode}__${r.refFournisseur}`.toUpperCase();

    await setDoc(
      doc(col, id),
      {
        fournisseurCode: r.fournisseurCode || "",
        fournisseurNom: r.fournisseurNom || "",
        refFournisseur: r.refFournisseur || "",
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
  }

  alert("✅ Import AF_MAP terminé !");
}

window.importAFMap = importAFMap;
