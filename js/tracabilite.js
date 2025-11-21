import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy
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
};

function toDateOrNull(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(val) {
  if (!val) return "";

  // Firestore Timestamp
  if (val.toDate) {
    const d = val.toDate();
    return d.toLocaleDateString("fr-FR");
  }

  // Date native
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
  loadTraceability().catch(console.error);
});

// Mise en place d’une date “Au” automatique à aujourd’hui
window.addEventListener("load", () => {
  const today = new Date();
  els.to.value = today.toISOString().split("T")[0];
  loadTraceability().catch(console.error);
});


/*******************************************
 * CHARGEMENT PRINCIPAL
 *******************************************/
async function loadTraceability() {
  els.btn.disabled = true;
  els.list.innerHTML = `<div class="no-movements">Chargement…</div>`;

  const fromDate = toDateOrNull(els.from.value);
  const toDate = toDateOrNull(els.to.value);
  const pluFilter = els.plu.value.trim();
  const fournFilter = normStr(els.fourn.value.trim());
  const typeFilter = els.type.value;

  // 1️⃣ Charger les lots
  const lots = await fetchLots({ fromDate, toDate, pluFilter });

  if (!lots.length) {
    els.list.innerHTML = `<div class="no-movements">Aucun lot trouvé.</div>`;
    els.btn.disabled = false;
    return;
  }

  const cards = [];

  // 2️⃣ Pour chaque lot → achat + ligne + mouvements
  for (const lotDoc of lots) {
    const lotId = lotDoc.id;
    const lot = lotDoc.data();

    const achatInfo = await fetchAchatAndLine(lot);
    // Si lot transformé → pas d'achat, pas de ligne, mais on doit AFFICHER
if (!achatInfo && lot.source !== "transformation") continue;

const achat = achatInfo?.achat || null;
const ligne = achatInfo?.ligne || null;


    const { achat, ligne } = achatInfo;

    // filtre fournisseur
    if (fournFilter) {
      const f = normStr(achat?.fournisseurNom || achat?.fournisseur || "");
      if (!f.includes(fournFilter)) continue;
    }

    const mouvements = await fetchMovementsForLot(lotId);

    // règles métier de filtrage
    const poidsRestant = lot.poidsRestant ?? 0;
    const closed = !!lot.closed || poidsRestant <= 0;

    let include = true;

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

    cards.push({ lotId, lot, achat, ligne, mouvements });
  }

  if (!cards.length) {
    els.list.innerHTML = `<div class="no-movements">Aucun mouvement correspondant.</div>`;
    els.btn.disabled = false;
    return;
  }

  // 3️⃣ Tri des lots : plus récent d’abord
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

  // 4️⃣ rendu final
  renderCards(cards, typeFilter);

  els.btn.disabled = false;
}


/*******************************************
 * FETCH LOTS
 *******************************************/
async function fetchLots({ fromDate, toDate, pluFilter }) {
  const colLots = collection(db, "lots");
  let qRef;

  if (pluFilter) {
    qRef = query(colLots, where("plu", "==", pluFilter));
  } else if (fromDate || toDate) {
    const constraints = [];
    if (fromDate) constraints.push(where("createdAt", ">=", fromDate));
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      constraints.push(where("createdAt", "<=", end));
    }
    qRef = query(colLots, ...constraints, orderBy("createdAt", "desc"));
  } else {
    qRef = query(colLots, orderBy("createdAt", "desc"));
  }

  const snap = await getDocs(qRef);
  return snap.docs;
}


/*******************************************
 * FETCH ACHAT & LIGNE
 *******************************************/
async function fetchAchatAndLine(lot) {
  try {
    if (!lot.achatId || !lot.ligneId) return null;

    const achatRef = doc(db, "achats", lot.achatId);
    const achatSnap = await getDoc(achatRef);
    if (!achatSnap.exists()) return null;

    const ligneRef = doc(db, `achats/${lot.achatId}/lignes`, lot.ligneId);
    const ligneSnap = await getDoc(ligneRef);
    if (!ligneSnap.exists()) return null;

    return {
      achat: achatSnap.data(),
      ligne: ligneSnap.data(),
    };
  } catch (e) {
    console.error("fetchAchatAndLine error", e);
    return null;
  }
}


/*******************************************
 * FETCH MOUVEMENTS
 *******************************************/
async function fetchMovementsForLot(lotId) {
  const col = collection(db, "stock_movements");
  const qRef = query(
    col,
    where("lotId", "==", lotId),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(qRef);
  return snap.docs.map(d => d.data());
}


/*******************************************
 * RENDER FINAL
 *******************************************/
function renderCards(cards, typeFilter) {
  let html = "";

  for (const { lotId, lot, achat, ligne, mouvements } of cards) {
    const poidsInitial = lot.poidsInitial || ligne?.poidsKg || 0;
    const poidsRestant = lot.poidsRestant ?? 0;
    const closed = !!lot.closed || poidsRestant <= 0;

    const badgeClass = closed ? "badge-closed" : "badge-open";
    const badgeLabel = closed ? "CONSOMMÉ" : "EN COURS";

    const fournisseur = achat?.fournisseurNom 
                 || achat?.fournisseur 
                 || (lot.source === "transformation" ? "Transformation interne" : "");

    const achatDate =
      achat?.date || achat?.createdAt || lot.createdAt;

    // Filtrage des mouvements affichés
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
          <strong>Zone :</strong> ${lot.zone || ligne?.zone || ""} ${lot.sousZone || ligne?.sousZone || ""}<br>
          <strong>Engin :</strong> ${lot.engin || ligne?.engin || ""}<br>
          ${ lot.source === "transformation" && lot.origineLots ? `
  <strong>Origine :</strong><br>
  ${lot.origineLots.map(o => `• Lot ${o.lotId} : ${o.kgPris}kg`).join("<br>")}
` : "" }

${ lot.photo_url ? `
  <br><img class="trace-photo" src="${lot.photo_url}">
` : "" }
          <span class="${badgeClass}">${badgeLabel}</span><br>
          <strong>Reste :</strong> ${poidsRestant} kg / ${poidsInitial} kg
          ${
            lot.photo_url || ligne?.photo_url
              ? `<br><img class="trace-photo" src="${lot.photo_url || ligne.photo_url}">`
              : ""
          }
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

  els.list.innerHTML = html;
}
