import {
  onDocumentWritten,
  onDocumentDeleted
} from "firebase-functions/v2/firestore";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

/************************************************************
 * 1️⃣ Crée un ID unique pour chaque lot
 ************************************************************/
function makeLotId(achatId, ligneId) {
  return `${achatId}__${ligneId}`;
}

/************************************************************
 * 2️⃣ Sync d’un lot à partir d’une ligne d’achat
 ************************************************************/
export const syncLotFromAchatLine = onDocumentWritten(
  {
    region: "europe-west1",   // ← OBLIGATOIRE
    document: "achats/{achatId}/lignes/{ligneId}"
  },
  async (event) => {
    const achatId = event.params.achatId;
    const ligneId = event.params.ligneId;

    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;

    const lotId = makeLotId(achatId, ligneId);
    const lotRef = db.collection("lots").doc(lotId);

    // 🔥 Ligne supprimée → supprimer lot
    if (!after) {
      console.log("DELETE LOT", lotId);
      await lotRef.delete().catch(() => {});
      return;
    }

    // 🔥 Ligne non reçue → pas de lot
    if (!after.received) {
      console.log("IGNORED (not received)", lotId);
      await lotRef.delete().catch(() => {});
      return;
    }

    // 🔥 Poids
    const poids =
      Number(after.poidsKg) ||
      Number(after.poidsTotalKg) ||
      Number(after.poidsColisKg) ||
      0;

    if (!poids || poids <= 0) {
      console.log("IGNORED (no weight)", lotId);
      await lotRef.delete().catch(() => {});
      return;
    }

    // 🔥 Construction du lot
    const lotData = {
      lotId,
      achatId,
      ligneId,

      designation: after.designation || "",
      nomLatin: after.nomLatin || "",
      plu: after.plu || "",
      gencode: after.gencode || "",
      fournisseurRef: after.fournisseurRef || "",
      fao: after.fao || after.zone || "",
      zone: after.zone || "",
      sousZone: after.sousZone || "",
      engin: after.engin || "",

      prixAchatKg: Number(after.prixHTKg || after.prixKg || 0),

      createdAt: after.updatedAt || new Date(),
      lotDate: after.createdAt || new Date(),

      poidsInitial: poids,
      poidsRestant: poids,
      closed: false,

      source: "achat"
    };

    console.log("UPSERT LOT", lotId);
    await lotRef.set(lotData, { merge: true });
  }
);

/************************************************************
 * 3️⃣ Suppression des lots d’un achat supprimé
 ************************************************************/
export const deleteLotsOnAchatDelete = onDocumentDeleted(
  {
    region: "europe-west1",     // ← OBLIGATOIRE
    document: "achats/{achatId}"
  },
  async (event) => {
    const achatId = event.params.achatId;

    const snap = await db
      .collection("lots")
      .where("achatId", "==", achatId)
      .get();

    const batch = db.batch();
    snap.forEach((doc) => batch.delete(doc.ref));

    console.log("DELETE ALL LOTS FOR ACHAT:", achatId);

    await batch.commit();
  }
);
