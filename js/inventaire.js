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
  const lotsSnap = await getDocs(query(collection(db, "lots"), where("plu", "==", plu)));
  let totalKg = 0;
  lotsSnap.forEach(l => { const d = l.data(); totalKg += Number(d.poidsRestant || 0); });
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
    // copié en draft (safe)
    const finalDoc = snapFinal.docs[0];
    const finalData = finalDoc.data();
    const newDocRef = doc(collection(db, "inventories"));
    const copy = {
      ...finalData,
      status: "draft",
      createdAt: serverTimestamp(),
      copiedFrom: finalDoc.id,
      finalizedAt: finalData.finalizedAt || null
    };
    copy.lines = Array.isArray(finalData.lines) && finalData.lines.length ? finalData.lines : (rowsFromLots || []);
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
    plu,
    designation,
    poidsInitial: qty,
    poidsRestant: qty,
    prixAchatKg: Number(unitCost || 0),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    origin: "inventaire_session",
    sessionId
  };
  await setDoc(doc(db, "lots", id), lotObj);

  const mvId = `${id}__add__${Date.now()}`;
  const mvObj = {
    type: "inventory",
    sens: "entree",
    poids: qty,
    lotId: id,
    plu,
    user: opts.user || "system",
    createdAt: serverTimestamp(),
    prixAchatKg: Number(unitCost || 0),
    pma: Number(unitCost || 0),
    salePriceTTC: null,
    saleId: `INV_${mvId}`,
    origin: "inventaire_session",
    sessionId
  };

  // ajouter date si fournie (format YYYY-MM-DD)
  if (opts.date) {
    const d = (typeof opts.date === 'string') ? opts.date : (new Date(opts.date)).toISOString().slice(0,10);
    mvObj.date = d;
  }

  await setDoc(doc(db, "stock_movements", mvId), mvObj);

  await recomputeStockArticleFromLots(plu);
  return id;
}

/* ---------- Rollback d'une application de session (si déjà appliquée) ---------- */
async function clearSessionApplication(sessionId) {
  console.log("Rollback application session", sessionId);
  const mvSnap = await getDocs(query(collection(db, "stock_movements"),
    where("origin", "==", "inventaire_session"),
    where("sessionId", "==", sessionId)));
  if (mvSnap.empty) return;

  const mouvements = [];
  mvSnap.forEach(d => mouvements.push({ id: d.id, ...d.data() }));

  // sorties : remettre quantité dans lot (ou recréer)
  const sorties = mouvements.filter(m => m.sens === "sortie" && m.lotId);
  for (const mv of sorties) {
    try {
      const lotRef = doc(db, "lots", mv.lotId);
      const lotSnap = await getDoc(lotRef);
      if (!lotSnap.exists()) {
        await setDoc(lotRef, {
          plu: mv.plu,
          designation: mv.designation || "",
          poidsRestant: mv.poids || 0,
          prixAchatKg: mv.prixAchatKg || 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          origin: "inventaire_session_recreated",
          sessionId
        });
      } else {
        const l = lotSnap.data();
        const newPoids = (Number(l.poidsRestant || 0) + Number(mv.poids || 0));
        await updateDoc(lotRef, {
          poidsRestant: newPoids,
          closed: newPoids <= 0 ? true : false,
          updatedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn("Erreur rollback sortie", e);
    }
  }

  // entrees : supprimer lot si créé par session, sinon soustraire qty
  const entrees = mouvements.filter(m => m.sens === "entree" && m.lotId);
  for (const mv of entrees) {
    try {
      const lotRef = doc(db, "lots", mv.lotId);
      const lotSnap = await getDoc(lotRef);
      if (lotSnap.exists()) {
        const lotData = lotSnap.data();
        if (lotData.origin === "inventaire_session" && lotData.sessionId === sessionId) {
          await deleteDoc(lotRef);
        } else {
          const newPoids = Number((lotData.poidsRestant || 0) - Number(mv.poids || 0));
          await updateDoc(lotRef, {
            poidsRestant: newPoids > 0 ? newPoids : 0,
            closed: newPoids <= 0,
            updatedAt: serverTimestamp()
          });
        }
      }
    } catch (e) {
      console.warn("Erreur rollback entree", e);
    }
  }

  // supprimer mouvements (en chunks)
  for (let i=0;i<mouvements.length;i+=300) {
    const chunk = mouvements.slice(i, i+300);
    const batch = writeBatch(db);
    for (const m of chunk) batch.delete(doc(db, "stock_movements", m.id));
    await batch.commit();
  }

  // recompute stock_articles impactés
  const impacted = Array.from(new Set(mouvements.map(m => String(m.plu))));
  for (const plu of impacted) await recomputeStockArticleFromLots(plu);

  console.log("Rollback session terminé:", sessionId);
}

/* ---------- Rendu tableau + saisie (autosave) ---------- */

function renderInventaireTableFromData() {
  const rowsHtml = dataInventaire.map(item => `
    <tr data-plu="${item.plu}">
      <td>${item.plu}</td>
      <td>${item.designation || ""}</td>
      <td>${n2(item.stockTheo || 0)}</td>
      <td>${n2(item.prixKg || 0)}</td>
      <td>${n2(item.caTTC || 0)}</td>
      <td>${n2(item.poidsVendu || 0)}</td>
      <td>${n2(item.caTTC || 0)}</td>
      <td>
        <input class="stock-reel-input" type="number" step="0.01" value="${n2(item.stockReel || 0)}" style="width:80px;">
      </td>
      <td class="ecart-cell">${n2(item.stockReel - (item.stockTheo || 0))}</td>
      <td></td>
    </tr>
  `).join("");
  tbody.innerHTML = rowsHtml;
}

function activerSaisieDirecte() {
  document.querySelectorAll(".stock-reel-input").forEach(input => {
    input.addEventListener("input", e => {
      const tr = e.target.closest("tr");
      const plu = tr.dataset.plu;
      const nv = Number(e.target.value);
      const item = dataInventaire.find(x => String(x.plu) === String(plu));
      if (!item) return;
      item.stockReel = nv;
      item.ecart = nv - (item.stockTheo || 0);
      tr.querySelector(".ecart-cell").textContent = n2(item.ecart);
      const sessionId = window.currentInventorySessionId;
      if (sessionId) {
        const sessionObj = { lines: dataInventaire };
        scheduleSaveSession(sessionId, sessionObj);
      }
    });
  });
}

/* ---------- Charger inventaire (nouveau flux) ---------- */
async function chargerInventaire() {
  const dateInv = dateInput.value;
  if (!dateInv) {
    alert("Choisis une date d’inventaire !");
    return;
  }

  // Lire CA stocké (date-aware)
  const dateKey = "inventaireCA_" + dateInv;
  let ventesRaw = {};
  try {
    ventesRaw = JSON.parse(localStorage.getItem(dateKey) || localStorage.getItem("inventaireCA") || "{}");
  } catch (e) {
    console.warn("Erreur parse inventaireCA localStorage", e);
    ventesRaw = {};
  }

  const { ventesEANNet, extraPoidsByPlu } = await expandPlateauxFromCA(ventesRaw);

  tbody.innerHTML = "<tr><td colspan='9'>⏳ Chargement…</td></tr>";

  // 1) lire tous les lots ouverts (comme avant)
  const snapLots = await getDocs(query(collection(db, "lots"), where("closed", "==", false)));
  const regroup = {};
  snapLots.forEach(l => {
    const d = l.data();
    if (!regroup[d.plu]) regroup[d.plu] = { plu: d.plu, designation: d.designation || "", lots: [], stockTheo: 0 };
    regroup[d.plu].stockTheo += d.poidsRestant;
    regroup[d.plu].lots.push({ id: l.id, ...d });
  });

  // 2) prix vente réel
  const snapStockArticles = await getDocs(collection(db, "stock_articles"));
  const prixVente = {};
  snapStockArticles.forEach(sa => {
    const d = sa.data();
    const pluKey = d.PLU || sa.id.replace("PLU_", "");
    prixVente[pluKey] = d.pvTTCreel || 0;
  });

  // 3) construire lignes par PLU
  const rowsForSession = [];
  for (const plu of Object.keys(regroup)) {
    const stockTheo = regroup[plu].stockTheo;
    const designation = regroup[plu].designation;
    const artSnap = await getDoc(doc(db, "articles", plu));
    const artEanRaw = artSnap.exists() ? (artSnap.data().ean || artSnap.data().EAN || null) : null;

    // UTILISER getCaForEan pour tolérer formats différents
    const caTTC = artEanRaw ? getCaForEan(artEanRaw, ventesEANNet) : 0;

    const prixKg = prixVente[plu] || 0;
    let poidsVendu = prixKg > 0 ? caTTC / prixKg : 0;
    const extraPoids = extraPoidsByPlu[plu] || 0;
    poidsVendu += extraPoids;
    const caPlateaux = extraPoids * prixKg;
    const caTTCAffiche = caTTC + caPlateaux;
    const stockReel = stockTheo - poidsVendu;
    const ecart = stockReel - stockTheo;

    rowsForSession.push({
      plu,
      designation,
      stockTheo,
      prixKg,
      caTTC: caTTCAffiche,
      poidsVendu,
      stockReel: Number(stockReel.toFixed(2)),
      ecart: Number(ecart.toFixed(2)),
      unitCost: null
    });
  }

  // find or create draft session
  const session = await findOrCreateDraftSessionForDate(dateInv, rowsForSession);
  const sessionId = session.id;
  let sessionData = session.data;

  // --- NOUVEAU : si la session existe déjà et contient des lines,
  // on met à jour/merge ces lines avec les valeurs recalculées depuis rowsForSession
  // (cela permet à l'import CA récent de mettre à jour poidsVendu / ecart)
  const rowsMap = {};
  for (const r of rowsForSession) rowsMap[String(r.plu)] = r;

  let changed = false;
  if (Array.isArray(sessionData.lines) && sessionData.lines.length) {
    // mettre à jour chaque ligne existante avec les valeurs recalculées si trouvées
    for (let i = 0; i < sessionData.lines.length; i++) {
      const line = sessionData.lines[i] || {};
      const pluKey = String(line.plu);
      const newRow = rowsMap[pluKey];
      if (newRow) {
        // champs recalculés depuis lots + CA : stockTheo, prixKg, caTTC, poidsVendu, stockReel, ecart
        // on garde unitCost si l'utilisateur l'avait saisi
        const merged = {
          ...line,
          stockTheo: newRow.stockTheo,
          prixKg: newRow.prixKg,
          caTTC: newRow.caTTC,
          poidsVendu: newRow.poidsVendu,
          stockReel: Number((newRow.stockReel).toFixed(2)),
          ecart: Number(((newRow.stockReel) - newRow.stockTheo).toFixed(2)),
          unitCost: (line.unitCost != null && line.unitCost !== "") ? line.unitCost : (newRow.unitCost || null)
        };
        if (JSON.stringify(merged) !== JSON.stringify(line)) {
          sessionData.lines[i] = merged;
          changed = true;
        }
        delete rowsMap[pluKey];
      } else {
        // pas de nouveau calcul pour ce PLU → on conserve la ligne existante
      }
    }
    // pour les PLU présents dans rowsForSession mais absents de sessionData.lines → on les ajoute
    for (const remainingPlu of Object.keys(rowsMap)) {
      sessionData.lines.push(rowsMap[remainingPlu]);
      changed = true;
    }
  } else {
    // pas de lines dans la session (neuve) → écrire rowsForSession comme avant
    sessionData.lines = rowsForSession;
    changed = true;
  }

  // si on a modifié la session côté client, on la persiste pour que la UI et la DB soient cohérentes
  if (changed) {
    try {
      await updateDoc(doc(db, "inventories", sessionId), {
        lines: sessionData.lines,
        updatedAt: serverTimestamp()
      });
      console.log("Session inventaire mise à jour avec données CA :", sessionId);
    } catch (e) {
      console.warn("Erreur mise à jour session après merge CA :", e);
    }
  }

  // load into dataInventaire
  dataInventaire = sessionData.lines.map(l => ({ ...l })); // shallow copy to edit
  renderInventaireTableFromData();
  activerSaisieDirecte();

  window.currentInventorySessionId = sessionId;
  if (sessionStatusEl) sessionStatusEl.textContent = `Session chargée: ${sessionId} (status: ${sessionData.status || "draft"})`;
  console.log("Session chargée:", sessionId);
}

/* ---------- Finalisation (appliquer l'inventaire) ---------- */
btnValider.addEventListener("click", async () => {
  const dateInv = dateInput.value;
  if (!dateInv) { alert("Choisis une date d’inventaire !"); return; }
  if (!window.currentInventorySessionId) { alert("Aucune session chargée."); return; }

  if (!confirm("Valider et appliquer l'inventaire pour cette session ?")) return;

  const sessionRef = doc(db, "inventories", window.currentInventorySessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) { alert("Session introuvable."); return; }
  const sessionData = sessionSnap.data();

  // if previously applied, rollback
  if (sessionData.applied) {
    if (!confirm("Cette session a déjà été appliquée. Voulez-vous annuler l'application précédente et ré-appliquer ?")) return;
    valideStatus.textContent = "⏳ Rollback de l'application précédente…";
    await clearSessionApplication(window.currentInventorySessionId);
  }

  valideStatus.textContent = "⏳ Application des corrections…";
  const user = auth.currentUser ? auth.currentUser.email : "inconnu";
  const journalChanges = [];

  for (const item of dataInventaire) {
    // read open lots & current total
    const lotsSnap = await getDocs(query(collection(db, "lots"), where("plu", "==", item.plu), where("closed", "==", false)));
    let currentKg = 0;
    const lots = [];
    lotsSnap.forEach(l=> { const d = l.data(); currentKg += Number(d.poidsRestant || 0); lots.push({ id: l.id, ...d }); });

    const counted = Number(item.stockReel || 0);
    const changeLine = {
      plu: item.plu,
      designation: item.designation || "",
      prevStock: currentKg,
      counted,
      ecart: counted - currentKg,
      user,
      // use client ISO timestamp (serverTimestamp not allowed inside arrays)
      ts: new Date().toISOString()
    };

    if (counted < currentKg) {
      // applyInventory expects (plu, poidsReel, user, opts); pass date & sessionId so movements carry date/sessionId
      await applyInventory(item.plu, counted, user, { date: dateInv, sessionId: window.currentInventorySessionId });
    } else if (counted > currentKg) {
      const diff = counted - currentKg;
      let unitCost = item.unitCost;
      if (!unitCost || isNaN(unitCost)) {
        // compute PMA from lots if available
        let totalKg = 0, totalAchat = 0;
        lots.forEach(l => { totalKg += Number(l.poidsRestant || 0); totalAchat += Number(l.prixAchatKg || 0) * Number(l.poidsRestant || 0); });
        unitCost = totalKg > 0 ? (totalAchat / totalKg) : 0;
      }
      await createAddLotAndMovement(item.plu, diff, unitCost, window.currentInventorySessionId, { user, date: dateInv });
    } else {
      // equal -> nothing
    }

    await recomputeStockArticleFromLots(item.plu);
    journalChanges.push(changeLine);
  }

  // compute valeurStockHT = somme(prixAchatKg * poidsRestant) sur tous lots
  let totalStockHT = 0;
  const allLotsSnap = await getDocs(collection(db, "lots"));
  allLotsSnap.forEach(l => {
    const d = l.data();
    totalStockHT += Number(d.prixAchatKg || 0) * Number(d.poidsRestant || 0);
  });

  // write journal_inventaires/{date}
  await setDoc(doc(db, "journal_inventaires", dateInv), {
    date: dateInv,
    valeurStockHT: totalStockHT,
    changes: journalChanges,
    appliedBy: user,
    appliedAt: serverTimestamp()
  }, { merge: true });

  // mark session applied / finalized
  await updateDoc(sessionRef, {
    status: "finalized",
    finalizedAt: serverTimestamp(),
    applied: true,
    appliedAt: serverTimestamp(),
    appliedBy: user,
    lines: dataInventaire
  });

  valideStatus.textContent = "✅ Inventaire appliqué et finalisé !";
  alert("Inventaire appliqué et finalisé. Journal mis à jour.");
  await chargerInventaire();
});

/* ---------- Charger inventaire au clic / auto reload après import CA ---------- */
btnCharger.addEventListener("click", chargerInventaire);
window.addEventListener("inventaireCAReady", chargerInventaire);

/* ---------- Expose pour console debug ---------- */
window.chargerInventaire = chargerInventaire;
window.clearSessionApplication = clearSessionApplication;
window.createAddLotAndMovement = createAddLotAndMovement;
