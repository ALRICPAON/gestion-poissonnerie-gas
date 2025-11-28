// applyInventory.js (modifié pour enrichir stock_movements)
import { db } from './firebase-init.js';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  writeBatch,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

export async function applyInventory(plu, poidsReel, user) {
  const lotsRef = collection(db, 'lots');
  const q = query(lotsRef, where('plu', '==', plu), where('closed', '==', false), orderBy('createdAt'));
  const snapshot = await getDocs(q);

  let poidsTheorique = 0;
  const lots = [];

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    poidsTheorique += data.poidsRestant || 0;
    lots.push({ id: docSnap.id, ...data });
  });

  const ecart = poidsTheorique - poidsReel;
  if (ecart <= 0) return console.log(`✅ Aucune correction nécessaire pour PLU ${plu}`);

  // --- Calcul PMA (moyenne pondérée sur les lots ouverts) ---
  let totalKgForPma = 0;
  let totalAchatForPma = 0;
  for (const l of lots) {
    const kg = Number(l.poidsRestant || 0);
    const prix = Number(l.prixAchatKg || 0);
    totalKgForPma += kg;
    totalAchatForPma += (kg * prix);
  }
  const pma = totalKgForPma > 0 ? (totalAchatForPma / totalKgForPma) : (lots[0] ? Number(lots[0].prixAchatKg || 0) : 0);

  // --- Lecture PV réel (pvTTCreel) depuis stock_articles (fallback) ---
  let pvTTCreel = null;
  try {
    const saId = "PLU_" + String(plu);
    const saSnap = await getDoc(doc(db, "stock_articles", saId));
    if (saSnap.exists()) {
      pvTTCreel = saSnap.data().pvTTCreel || saSnap.data().pvTTCconseille || null;
    }
  } catch (e) {
    console.warn("Erreur lecture stock_articles pour pvTTCreel", e);
    pvTTCreel = null;
  }

  let resteADecremente = ecart;
  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const lot of lots) {
    if (resteADecremente <= 0) break;

    const reduction = Math.min(lot.poidsRestant, resteADecremente);
    const newPoids = lot.poidsRestant - reduction;

    batch.update(doc(db, 'lots', lot.id), {
      poidsRestant: newPoids,
      closed: newPoids <= 0 ? true : lot.closed,
      updatedAt: now
    });

    const mouvementId = `${lot.id}__inv__${Date.now()}`;
    const mouvementRef = doc(db, 'stock_movements', mouvementId);

    // enrichissements: prixAchatKg depuis le lot, pma calculé, salePriceTTC depuis stock_articles (pvTTCreel)
    const prixAchatKg = Number(lot.prixAchatKg || 0);

    batch.set(mouvementRef, {
      type: 'inventory',
      sens: 'sortie',
      poids: reduction,
      lotId: lot.id,
      plu,
      user,
      createdAt: now,
      prixAchatKg: prixAchatKg,
      pma: Number(pma || 0),
      salePriceTTC: pvTTCreel != null ? Number(pvTTCreel) : null,
      saleId: `INV_${mouvementId}`,
      origin: 'inventaire'
    });

    resteADecremente -= reduction;
  }

  await batch.commit();
  console.log(`📝 Inventaire appliqué pour PLU ${plu} (écart: ${ecart} kg)`);
}
