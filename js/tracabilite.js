import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const qs = (s) => document.querySelector(s);

const els = {
  from: qs("#filter-from"),
  to: qs("#filter-to"),
  plu: qs("#filter-plu"),
  fourn: qs("#filter-fournisseur"),
  type: qs("#filter-type"),
  btn: qs("#btn-apply"),
  list: qs("#trace-list"),
  loadMoreContainer: null,
  loadMoreBtn: null
};

const PAGE_SIZE = 30; // page size for lots
let lastDoc = null;   // last document snapshot for pagination
let hasMore = true;   // whether more pages are available
let currentFilters = {}; // keep current filters for load more

function toDateOrNull(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(val) {
  if (!val) return "";

  if (val.toDate) {
    const d = val.toDate();
    return d.toLocaleDateString("fr-FR");
  }

  if (val instanceof Date) {
    return val.toLocaleDateString("fr-FR");
  }

  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toLocaleDateString("fr-FR");

  return String(val);
}

function normStr(s) {
  return (s || "").toString().toLowerCase();
}

function isSaleLikeMovement(m) {
  const t = (m.type || "").toUpperCase();
  const sens = (m.sens || "").toLowerCase();
  if (t.includes("VENTE")) return true;
  if (m.type === "inventory") return true;
  if (sens === "sortie") return true;
  return false;
}

els.btn.addEventListener("click", () => {
  // reset pagination when applying new filters
  resetPagination();
  loadTraceability().catch(console.error);
});

window.addEventListener("load", () => {
  const today = new Date();
  els.to.value = today.toISOString().split("T")[0];
  resetPagination();
  loadTraceability().catch(console.error);
});

function resetPagination() {
  lastDoc = null;
  hasMore = true;
  currentFilters = {};
  if (els.loadMoreBtn) {
    els.loadMoreBtn.remove();
    els.loadMoreBtn = null;
  }
}

/*******************************************
 * CHARGEMENT PRINCIPAL (paged)
 *******************************************/
async function loadTraceability() {
  // store current filters (used for subsequent pages)
  currentFilters.fromDate = toDateOrNull(els.from.value);
  currentFilters.toDate = toDateOrNull(els.to.value);
  currentFilters.pluFilter = els.plu.value.trim();
  currentFilters.fournFilter = normStr(els.fourn.value.trim());
  currentFilters.typeFilter = els.type.value;

  // First page - clear list on first call (if lastDoc null)
  if (!lastDoc) {
    els.list.innerHTML = `<div class="no-movements">Chargement…</div>`;
  } else {
    // append loader
    const loader = document.createElement('div');
    loader.className = 'no-movements';
    loader.textContent = 'Chargement de la page suivante…';
    els.list.appendChild(loader);
  }

  els.btn.disabled = true;

  try {
    const { docs, lastDocument, empty } = await fetchLotsPaged({
      fromDate: currentFilters.fromDate,
      toDate: currentFilters.toDate,
      pluFilter: currentFilters.pluFilter,
      pageSize: PAGE_SIZE,
      startAfterDoc: lastDoc
    });

    if (lastDoc && els.list.querySelector('.no-movements')) {
      // remove temporary loader
      const tmp = els.list.querySelector('.no-movements');
      if (tmp) tmp.remove();
    }

    if (!docs.length) {
      if (!lastDoc) {
        els.list.innerHTML = `<div class="no-movements">Aucun lot trouvé.</div>`;
        els.btn.disabled = false;
        return;
      } else {
        // no more pages
        hasMore = false;
        if (els.loadMoreBtn) els.loadMoreBtn.disabled = true;
        els.btn.disabled = false;
        return;
      }
    }

    // collect unique achatIds and lotIds, and pairs for lignes
    const achatIdsSet = new Set();
    const lotIds = [];
    const linesPairs = new Set(); // key = `${achatId}::${ligneId}`

    for (const lotDoc of docs) {
      const l = lotDoc.data();
      if (l.achatId) achatIdsSet.add(l.achatId);
      lotIds.push(lotDoc.id);
      if (l.achatId && l.ligneId) linesPairs.add(`${l.achatId}::${l.ligneId}`);
    }

    // fetch achats in batches (by 10)
    const achatIds = Array.from(achatIdsSet);
    const achatsMap = await fetchAchatsByIds(achatIds); // Map achatId -> data

    // fetch lignes for needed pairs
    const lignePairsArr = Array.from(linesPairs).map(k => {
      const [achatId, ligneId] = k.split("::");
      return { achatId, ligneId };
    });
    const lignesMap = await fetchLignesByPairs(lignePairsArr); // Map key -> data

    // fetch movements for lots in batch
    const movementsMap = await fetchMovementsForLots(lotIds); // lotId -> [movements]

    // build cards array similar to previous logic but using maps to avoid per-lot requests
    const cards = [];
    for (const lotDoc of docs) {
      const lotId = lotDoc.id;
      const lot = lotDoc.data();

      const achat = lot.achatId ? achatsMap.get(lot.achatId) || null : null;
      const ligneKey = lot.achatId && lot.ligneId ? `${lot.achatId}::${lot.ligneId}` : null;
      const ligne = ligneKey ? (lignesMap.get(ligneKey) || null) : null;

      if (!achat && lot.source !== "transformation") continue;

      // apply fournisseur filter if set
      if (currentFilters.fournFilter) {
        const f = normStr(achat?.fournisseurNom || achat?.fournisseur || "");
        if (!f.includes(currentFilters.fournFilter)) continue;
      }

      // get mouvements from movementsMap
      const mouvements = movementsMap[lotId] || [];

      const poidsRestant = lot.poidsRestant ?? 0;
      const closed = !!lot.closed || poidsRestant <= 0;

      let include = true;
      const typeFilter = currentFilters.typeFilter;

      switch (typeFilter) {
        case "achat":
          include = closed;
          break;
        case "vente":
          include = mouvements.some(m => isSaleLikeMovement(m));
          break;
        case "inventaire":
          include = mouvements.some(m => m.type === "inventory");
          break;
        case "transformation":
          include = mouvements.some(m =>
            (m.type || "").toUpperCase().includes("TRANSFORMATION")
          );
          break;
      }
      if (!include) continue;

      // fetch photo (prefer lot.photo_url, then ligne photo)
      const photo = await fetchPhotoForLotOptimized(lot, ligne);

      cards.push({ lotId, lot, achat, ligne, mouvements, photo });
    }

    if (!cards.length) {
      if (!lastDoc) els.list.innerHTML = `<div class="no-movements">Aucun mouvement correspondant.</div>`;
      // else continue to next page or end
      lastDoc = lastDocument;
      hasMore = docs.length === PAGE_SIZE;
      ensureLoadMoreButton();
      els.btn.disabled = false;
      return;
    }

    // sort & render - keep same logic as before
    cards.sort((a, b) => {
      const dateA =
        a.achat?.date?.toDate?.() ||
        a.achat?.createdAt?.toDate?.() ||
        a.lot?.createdAt?.toDate?.() ||
        new Date(0);

      const dateB =
        b.achat?.date?.toDate?.() ||
        b.achat?.createdAt?.toDate?.() ||
        b.lot?.createdAt?.toDate?.() ||
        new Date(0);

      return dateB - dateA;
    });

    // if first page, replace list; else append
    if (!lastDoc) els.list.innerHTML = "";
    // render and append
    appendRenderCards(cards, currentFilters.typeFilter);

    // prepare for next page
    lastDoc = lastDocument;
    hasMore = docs.length === PAGE_SIZE;
    ensureLoadMoreButton();

  } catch (e) {
    console.error("loadTraceability error", e);
    if (!lastDoc) els.list.innerHTML = `<div class="no-movements">Erreur de chargement.</div>`;
  } finally {
    els.btn.disabled = false;
  }
}

/*******************************************
 * Paginated fetchLots
 * returns { docs: QueryDocumentSnapshot[], lastDocument, empty }
 *******************************************/
async function fetchLotsPaged({ fromDate, toDate, pluFilter, pageSize = PAGE_SIZE, startAfterDoc = null }) {
  const colLots = collection(db, "lots");
  const constraints = [];

  if (pluFilter) {
    constraints.push(where("plu", "==", pluFilter));
  }
  if (fromDate) constraints.push(where("createdAt", ">=", fromDate));
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    constraints.push(where("createdAt", "<=", end));
  }

  // Always order by createdAt desc for consistent pagination
  const qArgs = [...constraints, orderBy("createdAt", "desc"), limit(pageSize)];
  if (startAfterDoc) qArgs.push(startAfter(startAfterDoc));
  const qRef = query(colLots, ...qArgs);

  const snap = await getDocs(qRef);
  return { docs: snap.docs, lastDocument: snap.docs[snap.docs.length - 1] || null, empty: snap.empty };
}

/*******************************************
 * Batch fetch achats by ids (max 10 ids per query due to Firestore)
 * returns Map(achatId -> data)
 *******************************************/
async function fetchAchatsByIds(ids) {
  const map = new Map();
  if (!ids || !ids.length) return map;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const q = query(collection(db, "achats"), where("__name__", "in", batch));
    const snap = await getDocs(q);
    snap.docs.forEach(d => map.set(d.id, d.data()));
  }
  return map;
}

/*******************************************
 * Batch fetch lignes by pairs [{achatId, ligneId}]
 * returns Map(`${achatId}::${ligneId}` -> data)
 *******************************************/
async function fetchLignesByPairs(pairs) {
  const map = new Map();
  if (!pairs || !pairs.length) return map;
  // We still need to use getDoc on each subcollection document, but we do it in parallel
  const promises = pairs.map(async ({ achatId, ligneId }) => {
    try {
      const ref = doc(db, `achats/${achatId}/lignes`, ligneId);
      const snap = await getDoc(ref);
      if (snap.exists()) map.set(`${achatId}::${ligneId}`, snap.data());
    } catch (e) {
      // ignore
    }
  });
  await Promise.all(promises);
  return map;
}

/*******************************************
 * Batch fetch movements for an array of lotIds
 * returns object: { lotId: [movements...] }
 *******************************************/
async function fetchMovementsForLots(lotIds) {
  const out = {};
  if (!lotIds || !lotIds.length) return out;
  for (let i = 0; i < lotIds.length; i += 10) {
    const batch = lotIds.slice(i, i + 10);
    // query with where("lotId","in", batch)
    try {
      const q = query(collection(db, "stock_movements"), where("lotId", "in", batch), orderBy("createdAt", "asc"));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const m = d.data();
        if (!m.lotId) return;
        if (!out[m.lotId]) out[m.lotId] = [];
        out[m.lotId].push(m);
      });
    } catch (e) {
      console.warn("fetchMovementsForLots batch error", e);
    }
  }
  return out;
}

/*******************************************
 * Optimized fetchPhotoForLot that uses ligne data (if provided)
 *******************************************/
async function fetchPhotoForLotOptimized(lot, ligne) {
  // prefer lot.photo_url then ligne.photo_url then achat.ligne photo
  if (lot.photo_url) return lot.photo_url;
  if (ligne && (ligne.photo_url || ligne.photo)) return ligne.photo_url || ligne.photo;
  // As fallback, try to read ligne if not provided (rare)
  if (lot.achatId && lot.ligneId) {
    try {
      const ligneRef = doc(db, `achats/${lot.achatId}/lignes`, lot.ligneId);
      const snap = await getDoc(ligneRef);
      if (snap.exists()) {
        const data = snap.data();
        return data.photo_url || data.photo || null;
      }
    } catch (e) {
      console.error("fetchPhotoForLotOptimized fallback error", e);
    }
  }
  return null;
}

/*******************************************
 * Render helpers
 * - appendRenderCards: append HTML to existing list (preserve previous pages)
 * - ensureLoadMoreButton ensures the "Charger plus" button exists
 *******************************************/
function appendRenderCards(cards, typeFilter) {
  let html = "";
  for (const { lotId, lot, achat, ligne, mouvements, photo } of cards) {
    let faoHtml = "";
    let zoneHtml = "";
    let enginHtml = "";
    let latinHtml = "";
    let photosHtml = "";

    if (Array.isArray(lot.liste_zone) && lot.liste_zone.length) {
      faoHtml   = `<strong>FAO :</strong> ${lot.liste_fao.join(" / ")}<br>`;
      zoneHtml  = `<strong>Zones :</strong> ${lot.liste_zone.join(" / ")}<br>`;
      enginHtml = `<strong>Engins :</strong> ${lot.liste_engin.join(" — ")}<br>`;
      latinHtml = `<strong>Espèces :</strong> ${lot.liste_nomLatin.join(", ")}<br>`;

      if (Array.isArray(lot.liste_photos) && lot.liste_photos.length) {
        photosHtml = lot.liste_photos
          .map(url => `<img class="trace-photo" src="${url}" loading="lazy" data-large="${url}">`)
          .join("");
      }
    } else {
      faoHtml   = `<strong>FAO :</strong> ${lot.fao || ""}<br>`;
      zoneHtml  = `<strong>Zone :</strong> ${lot.zone || ""} ${lot.sousZone || ""}<br>`;
      enginHtml = `<strong>Engin :</strong> ${lot.engin || ""}<br>`;
      latinHtml = lot.nomLatin ? `<strong>Espèce :</strong> ${lot.nomLatin}<br>` : "";

      const simplePhoto =
        lot.photo_url ||
        ligne?.photo_url ||
        null;

      if (simplePhoto) {
        // use data-large for popup. We use same URL for thumb (no thumbnail available)
        photosHtml = `<img class="trace-photo" src="${simplePhoto}" loading="lazy" data-large="${simplePhoto}">`;
      }
    }

    const poidsInitial = lot.poidsInitial || ligne?.poidsKg || 0;
    const poidsRestant = lot.poidsRestant ?? 0;
    const closed = !!lot.closed || poidsRestant <= 0;

    const badgeClass = closed ? "badge-closed" : "badge-open";
    const badgeLabel = closed ? "CONSOMMÉ" : "EN COURS";

    const fournisseur =
      achat?.fournisseurNom ||
      achat?.fournisseur ||
      (lot.source === "transformation" ? "Transformation interne" : "");

    const achatDate = achat?.date || achat?.createdAt || lot.createdAt;

    let filteredMovements = mouvements;
    if (typeFilter === "vente") {
      filteredMovements = mouvements.filter(m => isSaleLikeMovement(m));
    } else if (typeFilter === "inventaire") {
      filteredMovements = mouvements.filter(m => m.type === "inventory");
    } else if (typeFilter === "transformation") {
      filteredMovements = mouvements.filter(m =>
        (m.type || "").toUpperCase().includes("TRANSFORMATION")
      );
    }

    html += `
      <div class="trace-card">

        <div class="trace-title">
          ACHAT — ${fmtDate(achatDate)} • Lot ${lotId}
        </div>

        <div class="trace-meta">
          <strong>PLU :</strong> ${lot.plu || ligne?.plu} — ${lot.designation || ligne?.designation}<br>
          <strong>Fournisseur :</strong> ${fournisseur}<br>
          <strong>Poids initial :</strong> ${poidsInitial} kg<br>

          ${faoHtml}
          ${zoneHtml}
          ${enginHtml}
          ${latinHtml}

          ${photosHtml}

          ${lot.source === "transformation" && lot.origineLots ? `
            <strong>Origine :</strong><br>
            ${lot.origineLots.map(o => `• Lot ${o.lotId} : ${o.kgPris}kg`).join("<br>")}
          ` : "" }

          <span class="${badgeClass}">${badgeLabel}</span><br>
          <strong>Reste :</strong> ${poidsRestant} kg / ${poidsInitial} kg
        </div>

        <div class="movements-title">Mouvements du lot</div>
    `;

    if (!filteredMovements.length) {
      html += `<div class="no-movements">Aucun mouvement.</div>`;
    } else {
      for (const m of filteredMovements) {
        html += `
          <div class="movement-line">
            → ${fmtDate(m.createdAt)} • ${m.type}
            | ${m.poids > 0 ? "+" : ""}${(m.poids || 0).toFixed(3)} kg
            ${
              m.poidsRestant !== undefined
                ? " | Reste : " + m.poidsRestant + " kg"
                : ""
            }
          </div>
        `;
      }
    }

    html += `</div>`;
  }

  // append to list
  els.list.insertAdjacentHTML('beforeend', html);
}

/* Ensure the "Charger plus" button exists and show/hide based on hasMore */
function ensureLoadMoreButton() {
  if (!els.loadMoreContainer) {
    els.loadMoreContainer = document.createElement('div');
    els.loadMoreContainer.style.textAlign = 'center';
    els.loadMoreContainer.style.margin = '12px 0';
    els.list.insertAdjacentElement('afterend', els.loadMoreContainer);
  }
  if (!els.loadMoreBtn) {
    els.loadMoreBtn = document.createElement('button');
    els.loadMoreBtn.className = 'btn btn-accent';
    els.loadMoreBtn.id = 'btn-load-more';
    els.loadMoreBtn.textContent = 'Charger plus';
    els.loadMoreBtn.addEventListener('click', () => {
      if (!hasMore) return;
      loadTraceability().catch(console.error);
    });
    els.loadMoreContainer.appendChild(els.loadMoreBtn);
  }
  els.loadMoreBtn.style.display = hasMore ? '' : 'none';
  els.loadMoreBtn.disabled = !hasMore;
}

/* =========================
   Popup image remain as before but delegated on trace-list
   ========================= */
function ensureImagePopupExists() {
  if (document.getElementById('img-popup')) return;
  const html = `
    <div id="img-popup" class="popup" aria-hidden="true">
      <div class="popup-content" role="dialog" aria-modal="true">
        <img id="img-popup-src" alt="">
        <div style="text-align:right; margin-top:10px;">
          <button id="img-popup-close" class="btn btn-muted">Fermer</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const popup = document.getElementById('img-popup');
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.classList.remove('show');
  });
  document.getElementById('img-popup-close').addEventListener('click', () => {
    popup.classList.remove('show');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const p = document.getElementById('img-popup');
      if (p) p.classList.remove('show');
    }
  });
}

function showImagePopup(src, altText = '') {
  ensureImagePopupExists();
  const img = document.getElementById('img-popup-src');
  const popup = document.getElementById('img-popup');
  img.src = src;
  img.alt = altText || '';
  popup.classList.add('show');
  popup.setAttribute('aria-hidden', 'false');
}

const traceList = document.getElementById('trace-list');
if (traceList) {
  traceList.addEventListener('click', (e) => {
    const imgEl = e.target.closest ? e.target.closest('.trace-photo') : null;
    if (!imgEl) return;
    const src = imgEl.dataset.large || imgEl.getAttribute('src');
    if (!src) return;
    showImagePopup(src, imgEl.alt || '');
  });
}

/* expose for debugging if needed */
window.fetchPhotoForLot = fetchPhotoForLotOptimized;
