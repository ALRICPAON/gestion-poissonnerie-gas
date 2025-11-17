// functions/stock-sync-lots.js
import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Sync auto des LIGNES d'ACHATS vers la collection LOTS
 * - création / mise à jour / suppression
 */
export const syncLotsFromAchatLine = onDocumentWritten(
  "achats/{achatId}/lignes/{ligneId}",
  async (event) => {
    const { achatId, ligneId } = event.params;
    const before = event.data.before;
    const after  = event.data.after;

    const lotId = `${achatId}__${ligneId}`;
    const lotRef = db.collection("lots").doc(lotId);

    // 1) Cas suppression de ligne : on supprime le lot
    if (!after.exists) {
      console.log("Ligne supprimée → suppression lot", lotId);
      await lotRef.delete().catch(() => {});
      return;
    }

    const line = after.data();

    // On ne crée un lot que si la ligne est "reçue" (BL validé)
    const received = !!line.received;
    if (!received) {
      console.log("Ligne non reçue (received=false) → suppression lot si existant", lotId);
      await lotRef.delete().catch(() => {});
      return;
    }

    // 2) Calcul des poids / prix
    const poids =
      Number(line.poidsRestant || line.poidsKg || line.poidsTotalKg || line.poidsColisKg || 0);

    // Prix d'achat HT / kg
    let prixAchatKg = 0;
    if (line.prixHTKg != null) {
      prixAchatKg = Number(line.prixHTKg);
    } else if (line.prixKg != null) {
      prixAchatKg = Number(line.prixKg);
    } else if (line.montantHT && poids) {
      prixAchatKg = Number(line.montantHT) / poids;
    }

    // Si pas de poids ou pas de prix → pas de lot exploitable
    if (!poids || !prixAchatKg) {
      console.log("Ligne sans poids ou prix exploitable → suppression lot", lotId);
      await lotRef.delete().catch(() => {});
      return;
    }

    // 3) Construction de l'objet lot
    const now = admin.firestore.Timestamp.now();

    const lotData = {
      achatId,
      ligneId,
      source: "achat",
      closed: false,

      designation: line.designation || "",
      nomLatin: line.nomLatin || "",
      plu: line.plu || "",
      gencode: line.gencode || "",
      fao: line.fao || line.zone || "",
      zone: line.zone || "",
      sousZone: line.sousZone || "",
      engin: line.engin || "",

      fournisseurRef: line.refFournisseur || line.fournisseurRef || "",

      poidsInitial: poids,
      poidsRestant: poids,
      prixAchatKg: prixAchatKg,

      lotDate: line.lotDate || line.dateAchat || line.createdAt || now,
      createdAt: line.createdAt || now,
      updatedAt: now
    };

    console.log("Upsert lot", lotId, lotData);
    await lotRef.set(lotData, { merge: true });
  }
);
