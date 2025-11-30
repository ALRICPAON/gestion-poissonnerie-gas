// js/apply-inventory.js
// applyInventory (modifié pour accepter date/sessionId et marquer les mouvements)
// Usage: await applyInventory(plu, poidsReel, user, { date: "2025-11-30", sessionId: "r3Th..." });

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

/**
 * normalizeDateToYMD
 * accepte string "YYYY-MM-DD" ou Date, renvoie "YYYY-MM-DD" ou null
 */
function normalizeDateToYMD(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    // vérifie format YYYY-MM-DD rapide
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    // essaye de parser
    const dd = new Date(d);
    if (isFinite(dd)) {
      return dd.toISOString().slice(0,10);
    }
    return null;
  }
  if (d instanceof Date) {
    if (!isFinite(d)) return null;
    return d.toISOString().slice(0,10);
  }
  try {
    const dd = new Date(d);
    if (isFinite(dd)) return dd.toISOString().slice(0,10);
  } catch(e){}
  return null;
}

/**
 * applyInventory
 * - plu: identifiant produit
 * - poidsReel: poids compté (kg)
 * - user: string
 * - opts: { date: "YYYY-MM-DD" | Date, sessionId: string }
 *
 * Comportement :
 * - lit lots ouverts FIFO (orderBy createdAt)
 * - calcule écart = poidsTheorique - poidsReel
 * - si ecart <= 0 => rien à faire (log)
 * - sinon : décrémente les lots FIFO, met à jour lots (poidsRestant, closed, updatedAt)
 *   et crée des documents stock_movements de type 'inventory' / sens 'sortie'
 * - les mouvements incluent désormais : origin, sessionId, date (YYYY-MM-DD)
 */
export async function applyInventory(plu, poidsReel, user, opts = {}) {
  const lotsRef = collection(db, 'lots');
  const q = query(lotsRef, where('plu', '==', plu), where('closed', '==', false), orderBy('createdAt'));
  const snapshot = await getDocs(q);

  let poidsTheorique = 0;
  const lots = [];

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    poidsTheorique += Number(data.poidsRestant || 0);
    lots.push({ id: docSnap.id, ...data });
  });

  const ecart = Number(poidsTheorique) - Number(poidsReel || 0);
  if (ecart <= 0) {
    console.log(`✅ Aucune correction nécessaire pour PLU ${plu} (écart=${ecart})`);
    return { applied: false, ecart: ecart };
  }

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

  // opts handling
  const sessionId = opts && opts.sessionId ? String(opts.sessionId) : null;
  const inventoryDate = normalizeDateToYMD(opts && opts.date ? opts.date : null);
  // origin: 'inventaire_session' si sessionId fourni, sinon 'inventaire' (compatibilité)
  const originValue = sessionId ? 'inventaire_session' : 'inventaire';

  let resteADecremente = ecart;
  // On utilise des batches. Attention aux limites Firestore - pour des gros volumes il faudrait chunker.
  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const lot of lots) {
    if (resteADecremente <= 0) break;
    const lotPoids = Number(lot.poidsRestant || 0);
    if (lotPoids <= 0) continue;

    const reduction = Math.min(lotPoids, resteADecremente);
    const newPoids = lotPoids - reduction;

    // mise à jour lot
    batch.update(doc(db, 'lots', lot.id), {
      poidsRestant: newPoids,
      closed: newPoids <= 0 ? true : (lot.closed || false),
      updatedAt: now
    });

    // mouvement
    const mouvementId = `${lot.id}__inv__${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const mouvementRef = doc(db, 'stock_movements', mouvementId);

    const prixAchatKg = Number(lot.prixAchatKg || 0);

    const mvObj = {
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
      origin: originValue,
      sessionId: sessionId || null
    };

    // si on a une date d'inventaire on l'ajoute (format YYYY-MM-DD) pour que le dashboard puisse l'agréger par date
    if (inventoryDate) {
      mvObj.date = inventoryDate;
    }

    batch.set(mouvementRef, mvObj);

    resteADecremente -= reduction;
  }

  await batch.commit();

  console.log(`📝 Inventaire appliqué pour PLU ${plu} (écart: ${ecart} kg) - origin=${originValue} date=${inventoryDate || 'n/a'} sessionId=${sessionId || 'n/a'}`);

  return { applied: true, ecart: ecart, origin: originValue, date: inventoryDate, sessionId };
}

export default { applyInventory };
