// applyInventory.js
import { db } from './firebase-init.js';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
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

  snapshot.forEach(doc => {
    const data = doc.data();
    poidsTheorique += data.poidsRestant || 0;
    lots.push({ id: doc.id, ...data });
  });

  const ecart = poidsTheorique - poidsReel;
  if (ecart <= 0) return console.log(`✅ Aucune correction nécessaire pour PLU ${plu}`);

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
    batch.set(mouvementRef, {
      type: 'inventory',
      sens: 'sortie',
      poids: reduction,
      lotId: lot.id,
      plu,
      user,
      createdAt: now
    });

    resteADecremente -= reduction;
  }

  await batch.commit();
  console.log(`📝 Inventaire appliqué pour PLU ${plu} (écart: ${ecart} kg)`);
}
