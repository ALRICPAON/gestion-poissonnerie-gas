/******************************************************
 *  INVENTAIRE – VERSION EDITABLE PAR DATE (draft/final)
 *  - charge draft si existe, sinon copy finalized, sinon create draft from lots
 *  - autosave des lines (debounced)
 *  - finalize applique les changements (FIFO via applyInventory / création lots d'ajout)
 *  - rollback si ré-application d'une session déjà appliquée
 *****************************************************/

import { db, auth } from "./firebase-init.js";

import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  updateDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
  orderBy,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { applyInventory } from "../js/apply-inventory.js";

/* ---------- Elements HTML ---------- */
const btnCharger = document.querySelector("#btnCharger");
const btnValider = document.querySelector("#btnValider");
const tbody = document.querySelector("#inv-list");
const valideStatus = document.querySelector("#valideStatus");
const importStatus = document.querySelector("#importStatus");
const sessionStatusEl = document.querySelector("#sessionStatus"); // optional UI

/* ---------- Date input ajouté (comme avant) ---------- */
const dateInput = document.createElement("input");
dateInput.type = "date";
dateInput.id = "dateInventaire";
dateInput.style = "margin-left:20px;";
btnCharger.insertAdjacentElement("afterend", dateInput);

// reset import CA when date changes (compat avec inventaire-import.js)
dateInput.addEventListener("change", () => {
  localStorage.removeItem("inventaireCA");
  if (importStatus) importStatus.textContent = "⚠️ Import CA requis pour cette date.";
});

/* ---------- Mémoire et helpers ---------- */
let dataInventaire = [];  // source de vérité pour l'UI (lines)
window.currentInventorySessionId = null; // exposé pour debugging

function n2(v) { return Number(v || 0).toFixed(2); }

/* ---------- Helpers EAN / CA robustes ---------- */
// Normalise un ean stocké (supprime non-chiffres, pad 13)
function normalizeEan(eanRaw) {
  if (eanRaw == null) return null;
  const s = String(eanRaw).trim().replace(/\D/g, "");
  if (!s) return null;
  return s.length === 13 ? s : s.padStart(13, "0");
}

// retourne un caTTC depuis ventesEANNet en essayant plusieurs variantes
function getCaForEan(artEanRaw, ventesEANNet) {
  if (!ventesEANNet || Object.keys(ventesEANNet).length === 0) return 0;
  if (!artEanRaw) return 0;

  const normalized = normalizeEan(artEanRaw);
  // 1) exact match normalized (13 digits)
  if (normalized && ventesEANNet[normalized] != null) return Number(ventesEANNet[normalized] || 0);

  // 2) exact match using raw string (in case ventes keys have different padding)
  const rawStr = String(artEanRaw).trim();
  if (ventesEANNet[rawStr] != null) return Number(ventesEANNet[rawStr] || 0);

  // 3) try match by suffix (some imports may have lost leading zeroes): find a ventes key that endsWith raw digits
  const keys = Object.keys(ventesEANNet);
  for (const k of keys) {
    if (!k) continue;
    // compare last minLen digits
    const minLen = Math.min(k.length, rawStr.length);
    if (minLen > 3 && k.slice(-minLen) === rawStr.slice(-minLen)) {
      return Number(ventesEANNet[k] || 0);
    }
    // also try normalized suffix
    if (normalized && k.endsWith(normalized.slice(-minLen))) {
      return Number(ventesEANNet[k] || 0);
    }
  }

  // nothing found
  return 0;
}

/* ---------- Expand plateaux from CA (copié / inchangé) ---------- */
async function expandPlateauxFromCA(ventesEAN) {
  const user = auth.currentUser;
  if (!user) return { ventesEANNet: ventesEAN, extraPoidsByPlu: {}, extraCaByPlu: {} };

  const ventesEANNet = { ...(ventesEAN || {}) };

  // charge plateaux user
  const snapPlateaux = await getDocs(
    query(collection(db, "plateaux"), where("userId", "==", user.uid))
  );

  if (snapPlateaux.empty) {
    return { ventesEANNet, extraPoidsByPlu: {}, extraCaByPlu: {} };
  }

  const extraPoidsByPlu = {};
  const extraCaByPlu = {};

  for (const docP of snapPlateaux.docs) {
    const p = docP.data();
    const plateauPlu = String(p.plu || "").trim();
    const pvPlateau  = Number(p.pv || 0);
    const comps      = Array.isArray(p.composants) ? p.composants : [];

    if (!plateauPlu || pvPlateau <= 0 || comps.length === 0) continue;

    let eanPlateau = p.ean || null;
    if (!eanPlateau) {
      const artSnap = await getDoc(doc(db, "articles", plateauPlu));
      if (artSnap.exists()) eanPlateau = artSnap.data().ean || null;
    }
    if (!eanPlateau) continue;

    const caPlateau = Number(ventesEANNet[eanPlateau] || 0);
    if (caPlateau <= 0) continue;

    const parts = caPlateau / pvPlateau;
    for (const c of comps) {
      const pluC = String(c.plu || "").trim();
      const qtyC = Number(c.qty || 0);
      if (!pluC || qtyC <= 0) continue;
      const poids = parts * qtyC;
      if (!extraPoidsByPlu[pluC]) extraPoidsByPlu[pluC] = 0;
      extraPoidsByPlu[pluC] += poids;
      if (!extraCaByPlu[pluC]) extraCaByPlu[pluC] = 0;
      extraCaByPlu[pluC] += poids * (p.pv || 0);
    }

    delete ventesEANNet[eanPlateau];
  }

  return { ventesEANNet, extraPoidsByPlu, extraCaByPlu };
}

/* ---------- Helpers inventaire / sessions ---------- */

/**
 * Recompute stock_articles 'PLU_xxx' poids from lots
 */
async function recomputeStockArticleFromLots(plu) {
  // On ne prend que les lots ouverts : closed == false
  const lotsSnap = await getDocs(query(
    collection(db, "lots"),
    where("plu", "==", plu),
    where("closed", "==", false)
  ));
  let totalKg = 0;
  lotsSnap.forEach(l => { const d = l.data(); totalKg += Number(d.poidsRestant || 0); });

  // protection contre flottants (3 décimales suffisent)
  totalKg = Number(totalKg.toFixed(3));

  await setDoc(doc(db, "stock_articles", "PLU_" + plu), {
    poids: totalKg,
    updatedAt: serverTimestamp()
  }, { merge: true });
}


/**
 * findOrCreateDraftSessionForDate(date, rowsFromLots)
 * - retourne { id, data }
 * - priorité : draft > (copy finalized) > create draft from lots
 */
async function findOrCreateDraftSessionForDate(dateInv, rowsFromLots) {
  // 1) draft existante ?
  const qDraft = query(collection(db, "inventories"), where("date", "==", dateInv), where("status", "==", "draft"));
  const snapDraft = await getDocs(qDraft);
  if (!snapDraft.empty) {
    const d = snapDraft.docs[0];
    return { id: d.id, data: d.data() };
  }

  // 2) sinon chercher finalized la plus récente
  const qFinal = query(collection(db, "inventories"),
    where("date", "==", dateInv),
    where("status", "==", "finalized"),
    orderBy("finalizedAt", "desc"));
  const snapFinal = await getDocs(qFinal);
    if (!snapFinal.empty) {
    // copié en draft (safe) — ne pas recopier les flags d'application
    const finalDoc = snapFinal.docs[0];
    const finalData = finalDoc.data();
    const newDocRef = doc(collection(db, "inventories"));
    // Build a safe draft copy — do NOT copy applied/appliedAt/appliedBy/finalizedAt
    const copy = {
      date: finalData.date || dateInv,
      status: "draft",
      createdAt: serverTimestamp(),
      copiedFrom: finalDoc.id,
      // lines: keep existing lines if present, else rowsFromLots
      lines: Array.isArray(finalData.lines) && finalData.lines.length ? finalData.lines : (rowsFromLots || []),
      // ensure applied flags are reset for the draft
      applied: false,
      appliedAt: null,
      appliedBy: null,
      finalizedAt: null
    };
    await setDoc(newDocRef, copy);
    const newSnap = await getDoc(newDocRef);
    return { id: newSnap.id, data: newSnap.data() };
  }


  // 3) pas de session => create draft from lots (rowsFromLots)
  const newRef = doc(collection(db, "inventories"));
  const docObj = {
    date: dateInv,
    status: "draft",
    createdAt: serverTimestamp(),
    lines: rowsFromLots || []
  };
  await setDoc(newRef, docObj);
  const newSnap = await getDoc(newRef);
  return { id: newSnap.id, data: newSnap.data() };
}

/* ---------- Autosave debounce ---------- */
let saveTimeout = null;
function scheduleSaveSession(sessionId, sessionObj) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await updateDoc(doc(db, "inventories", sessionId), {
        lines: sessionObj.lines,
        updatedAt: serverTimestamp()
      });
      console.log("Inventaire autosauvé", sessionId);
    } catch (e) {
      console.error("Erreur autosave session", e);
    }
  }, 800);
}

/* ---------- Création lot d'ajout + mouvement (marqué session) ---------- */
async function createAddLotAndMovement(plu, qty, unitCost, sessionId, opts = {}) {
  const id = `INV_ADD_${plu}_${Date.now()}_${Math.floor(Math.random()*1000)}`;
  const artSnap = await getDoc(doc(db, "articles", String(plu)));
  const designation = artSnap.exists() ? (artSnap.data().designation || "") : "";
   const lotObj = {
