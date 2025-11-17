import { db } from "./firebase-init.js";
import {
  collection, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

export async function convertAchatsToLots() {
  console.log("=== Conversion achats → lots ===");

  const achatsSnap = await getDocs(collection(db, "achats"));

  for (const achatDoc of achatsSnap.docs) {
    const achatId = achatDoc.id;
    const achat = achatDoc.data();

    console.log("Achat :", achatId, "type :", achat.type);

    // 🛑 1) Ne convertir QUE les BL
    if (achat.type !== "BL") {
      console.warn(" → Ignoré (pas un BL)");
      continue;
    }

    // récupérer les lignes
    const lignesSnap = await getDocs(
      collection(db, "achats", achatId, "lignes")
    );

    if (lignesSnap.empty) {
      console.warn(" → Pas de lignes !");
      continue;
    }

    for (const ligneDoc of lignesSnap.docs) {
      const l = ligneDoc.data();

      // 🟦 2) Détection poids fiable
      const poids = Number(
        l.poidsTotalKg ||
        l.poidsKg ||
        l.poidsColisKg ||
        0
      );

      if (!poids || poids <= 0) {
        console.warn("   Ligne ignorée (poids=0) :", l.designation);
        continue;
      }

      // 🟦 3) Optional : si tu veux filtrer par réception
      // if (l.received !== true) {
      //   console.warn("   Ignorée (non reçue)");
      //   continue;
      // }

      console.log("   Lot créé :", l.designation, "poids :", poids);

      await addDoc(collection(db, "lots"), {
        achatId,
        ligneId: ligneDoc.id,

        plu: (l.plu || "").trim(),
        designation: l.designationInterne || l.designation || "",
        poidsInitial: poids,
        poidsRestant: poids,
        prixAchatKg: Number(l.prixHTKg || 0),

        lotDate: l.createdAt || serverTimestamp(),
        fournisseurRef: l.refFournisseur || "",
        nomLatin: l.nomLatin || "",
        zone: l.zone || "",
        sousZone: l.sousZone || "",
        engin: l.engin || "",
        fao: `${l.zone || ""} ${l.sousZone || ""}`.trim(),

        closed: false,
        source: "achat",
        createdAt: serverTimestamp(),
      });
    }
  }

  console.log("=== FIN ===");
  alert("Conversion terminée !");
}
