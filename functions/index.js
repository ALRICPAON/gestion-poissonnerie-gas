import {
  onDocumentWritten,
  onDocumentDeleted
} from "firebase-functions/v2/firestore";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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
    region: "europe-west1",
    document: "achats/{achatId}/lignes/{ligneId}"
  },
  async (event) => {
    const achatId = event.params.achatId;
    const ligneId = event.params.ligneId;

    const after = event.data?.after?.data() || null;

    const lotId = makeLotId(achatId, ligneId);
    const lotRef = db.collection("lots").doc(lotId);

    // 🔥 Ligne supprimée → supprimer lot
    if (!after) {
      await lotRef.delete().catch(() => {});
      return;
    }

    // 🔥 Ligne non reçue → pas de lot
    if (!after.received) {
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
      await lotRef.delete().catch(() => {});
      return;
    }

    // 🔥 DLC
    let dlc = null;
    if (after.dlc) {
      if (after.dlc.toDate) {
        dlc = after.dlc.toDate();
      } else {
        dlc = new Date(after.dlc);
      }
    }

    // 🔥 Construction du lot
    const now = Timestamp.now();

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

      dlc: dlc,  // ✅ ➜ NOUVEAU CHAMP !

      prixAchatKg: Number(after.prixHTKg || after.prixKg || 0),

      createdAt: after.createdAt || now,
      updatedAt: now,

      poidsInitial: poids,
      poidsRestant: poids,
      closed: false,

      source: "achat"
    };

    console.log("UPSERT LOT", lotId, lotData);
    await lotRef.set(lotData, { merge: true });
  }
);

/************************************************************
 * 3️⃣ Suppression des lots d’un achat supprimé
 ************************************************************/
export const deleteLotsOnAchatDelete = onDocumentDeleted(
  {
    region: "europe-west1",
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

    await batch.commit();
  }
);
