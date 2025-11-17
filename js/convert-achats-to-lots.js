import { db } from "./firebase-init.js";
import {
  collection, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**
 * Convertit TOUS les achats existants → LOTS
 * À exécuter UNE SEULE FOIS
 */
export async function convertAchatsToLots() {
  const achatsSnap = await getDocs(collection(db, "achats"));

  for (const achatDoc of achatsSnap.docs) {

    const achatId = achatDoc.id;
    const achat = achatDoc.data();

    // Récup lignes d’achat
    const lignesSnap = await getDocs(
      collection(db, "achats", achatId, "lignes")
    );

    for (const ligneDoc of lignesSnap.docs) {
      const l = ligneDoc.data();

      const poids = Number(l.poidsTotalKg || l.poidsKg || 0);
      if (!poids || poids <= 0) continue;

      const prixAchatKg = Number(l.prixHTKg || 0);

      // designation propre
      const desi = l.designationInterne || l.designation || "";

      // PLU peut être vide
      const plu = (l.plu || "").trim();

      // Détection GENCODE si LS (13 chiffres)
      let gencode = "";
      if (/^[0-9]{13}$/.test(plu)) {
        gencode = plu;
      }

      // FAO propre
      let fao = "";
      if (l.zone) fao += l.zone;
      if (l.sousZone) fao += " " + l.sousZone;

      await addDoc(collection(db, "lots"), {
        achatId,
        ligneId: ligneDoc.id,

        // article info
        plu: gencode ? "" : plu,
        gencode,
        designation: desi,

        // poids/prix
        poidsInitial: poids,
        poidsRestant: poids,
        prixAchatKg,

        // dates
        lotDate: l.date || achat.date || serverTimestamp(),

        // fournisseur
        fournisseurCode: achat.fournisseurCode || "",
        fournisseurNom: achat.fournisseurNom || "",
        fournisseurRef: l.refFournisseur || "",

        // traca
        nomLatin: l.nomLatin || "",
        zone: l.zone || "",
        sousZone: l.sousZone || "",
        fao: fao.trim(),
        engin: l.engin || "",
        dlc: l.dlc || "",

        // flags
        closed: false,
        source: "achat",
        createdAt: serverTimestamp(),
      });
    }
  }

  alert("Conversion terminée ! Tous les achats → lots");
}
