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

  // Date JS
  if (val instanceof Date) {
    return val.toLocaleDateString("fr-FR");
  }

  // String
  const asDate = new Date(val);
  if (!isNaN(asDate.getTime())) {
    return asDate.toLocaleDateString("fr-FR");
  }

  return String(val);
}

function normStr(s) {
  return (s || "").toString().toLowerCase();
}

// ---- Chargement principal ----
els.btn.addEventListener("click", () => {
  loadTraceability().catch(err => {
    console.error(err);
    els.list.innerHTML = `<div class="empty-msg">Erreur de chargement (voir console).</div>`;
  });
});

// Au chargement : on met "Au" = aujourd'hui, et on charge
window.addEventListener("load", () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  els.to.value = `${yyyy}-${mm}-${dd}`;

  loadTraceability().catch(console.error);
});

// Fonction utilitaire : détecter si un mouvement est "vente / sortie"
function isSaleLikeMovement(m) {
  const t = (m.type || "").toString().toUpperCase();
  const sens = (m.sens || "").toString().toLowerCase();

  // On considère "VENTE", "inventory" (écarts de stock) et toute sortie
  if (t.includes("VENTE")) return true;
  if (m.type === "inventory") return true;
  if (sens === "sortie") return true;
  return false;
}

async function loadTraceability() {
  els.btn.disabled = true;
  els.list.innerHTML = `<div class="empty-msg">Chargement…</div>`;

  const fromDate = toDateOrNull(els.from.value);
  const toDate = toDateOrNull(els.to.value);
  const pluFilter = els.plu.value.trim();
  const fournFilter = normStr(els.fourn.value.trim());
  const typeFilter = els.type.value; // all | achat | vente | inventaire | transformation

  // 1️⃣ Charger les lots
  const lots = await fetchLots({ fromDate, toDate, pluFilter });

  if (!lots.length) {
    els.list.innerHTML = `<div class="empty-msg">Aucun lot trouvé pour ces filtres.</div>`;
    els.btn.disabled = false;
    return;
  }

  const cards = [];

  // 2️⃣ Pour chaque lot → compléter avec achat + ligne + mouvements
  for (const lotDoc of lots) {
    const lotId = lotDoc.id;
    const lot = lotDoc.data();

    const achatInfo = await fetchAchatAndLine(lot);
    if (!achatInfo) continue;

    const { achat, ligne } = achatInfo;

    // Filtre fournisseur (texte libre)
    if (fournFilter) {
      const nomFourn = normStr(achat?.fournisseurNom || achat?.fournisseur || "");
      if (!nomFourn.includes(fournFilter)) {
        continue;
      }
    }

    // Mouvements du lot
    const mouvements = await fetchMovementsForLot(lotId);

    // Filtre métier par type
    const poidsRestant = lot.poidsRestant ?? 0;
    const closed = !!lot.closed || poidsRestant <= 0;

    let include = true;

    if (typeFilter === "achat") {
      // On veut surtout les lots consommés
      include = closed;
    } else if (typeFilter === "vente") {
      include = mouvements.some(m => isSaleLikeMovement(m));
    } else if (typeFilter === "inventaire") {
      include = mouvements.some(m => m.type === "inventory");
    } else if (typeFilter === "transformation") {
      include = mouvements.some(m => (m.type || "").toString().toUpperCase().includes("TRANSFORMATION"));
    }

    if (!include) continue;

    cards.push({ lotId, lot, achat, ligne, mouvements });
  }

  if (!cards.length) {
    els.list.innerHTML = `<div class="empty-msg">Aucun résultat après filtres.</div>`;
    els.btn.disabled = false;
    return;
  }

  // 3️⃣ Tri des cartes par date d'achat (plus récent en premier)
  cards.sort((a, b) => {
    const getD = (obj) => {
      const aData = obj.achat;
      const l = obj.lot;

      if (aData?.date?.toDate) return aData.date.toDate();
      if (aData?.createdAt?.toDate) return aData.createdAt.toDate();
      if (l?.createdAt?.toDate) return l.createdAt.toDate();
      return new Date(aData?.date || l?.createdAt || 0);
    };

    return getD(b) - getD(a);
  });

  // 4️⃣ Affichage
  renderCards(cards, typeFilter);

  els.btn.disabled = false;
}

// -------- Fetch lots : soit par PLU, soit par dates ----------
async function fetchLots({ fromDate, toDate, pluFilter }) {
  const lotsCol = collection(db, "lots");
  let qRef;

  if (pluFilter) {
    qRef = query(lotsCol, where("plu", "==", pluFilter));
  } else if (fromDate || toDate) {
    const constraints = [];
    if (fromDate) constraints.push(where("createdAt", ">=", fromDate));
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      constraints.push(where("createdAt", "<=", end));
    }
    qRef = query(lotsCol, ...constraints, orderBy("createdAt", "desc"));
  } else {
    qRef = query(lotsCol, orderBy("createdAt", "desc"));
  }

  const snap = await getDocs(qRef);
  return snap.docs;
}

// -------- Fetch achat + ligne associée au lot ----------
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

// -------- Fetch mouvements FIFO pour 1 lot ----------
async function fetchMovementsForLot(lotId) {
  const col = collection(db, "stock_movements");
  // Nécessite un index composite (lotId + createdAt)
  const qRef = query(col, where("lotId", "==", lotId), orderBy("createdAt", "asc"));
  const snap = await getDocs(qRef);

  const out = [];
  snap.forEach((doc) => {
    out.push(doc.data());
  });

  return out;
}

// -------- Affichage ----------
function renderCards(cards, typeFilter) {
  let html = "";

  for (const { lotId, lot, achat, ligne, mouvements } of cards) {
    const poidsInitial = lot.poidsInitial || ligne?.poidsKg || 0;
    const poidsRestant = lot.poidsRestant ?? 0;
    const closed = !!lot.closed || poidsRestant <= 0;
    const badgeClass = closed ? "badge badge-closed" : "badge badge-open";
    const badgeLabel = closed ? "CONSOMMÉ" : "EN COURS DE VENTE";

    const fournNom = achat?.fournisseurNom || achat?.fournisseur || "";
    const achatDate = achat?.date || achat?.createdAt || lot.createdAt;

    html += `
      <div class="achat-card">
        <div class="achat-header">
          <div class="achat-title">
            ACHAT — ${fmtDate(achatDate)} • Lot ${lotId}
          </div>
          <div class="achat-meta">
            PLU ${lot.plu || ligne?.plu || ""} — ${lot.designation || ligne?.designation || ""}
            <br>Fournisseur : ${fournNom || "-"}
            <br>Poids acheté : ${poidsInitial} kg
            <br>Zone : ${lot.zone || ligne?.zone || "-"} ${lot.sousZone || ligne?.sousZone || ""}
            <br>Engin : ${lot.engin || ligne?.engin || "-"}
            <br><span class="${badgeClass}">${badgeLabel}</span>
            <br>Restant : ${poidsRestant} kg / ${poidsInitial} kg
            ${lot.photo_url || ligne?.photo_url
              ? `<br><img class="photo-mini" src="${lot.photo_url || ligne.photo_url}" alt="Photo étiquette">`
              : ""
            }
          </div>
        </div>
    `;

    // Si on ne veut que les achats → pas besoin de détailler les mouvements
    if (typeFilter === "achat") {
      // On peut afficher les mouvements aussi si tu veux, mais tu avais demandé surtout les lots consommés
      html += `</div>`;
      continue;
    }

    // Filtrage d'affichage des mouvements suivant typeFilter
    let filteredMovements = mouvements;

    if (typeFilter === "vente") {
      filteredMovements = mouvements.filter(m => isSaleLikeMovement(m));
    } else if (typeFilter === "inventaire") {
      filteredMovements = mouvements.filter(m => m.type === "inventory");
    } else if (typeFilter === "transformation") {
      filteredMovements = mouvements.filter(m =>
        (m.type || "").toString().toUpperCase().includes("TRANSFORMATION")
      );
    }

    html += `<div class="movements-title">Mouvements du lot</div>`;

    if (!filteredMovements.length) {
      let msg = "Aucun mouvement enregistré pour ce lot.";

      if (typeFilter === "vente") {
        msg = "Aucun mouvement de vente/sortie pour ce lot.";
      } else if (typeFilter === "inventaire") {
        msg = "Aucun mouvement d'inventaire pour ce lot.";
      } else if (typeFilter === "transformation") {
        msg = "Aucune transformation pour ce lot.";
      } else if (closed) {
        msg = "Lot consommé — aucun mouvement détaillé disponible.";
      }

      html += `<div class="no-movements">${msg}</div>`;
    } else {
      for (const m of filteredMovements) {
        const type = m.type || "";
        const poids = m.poids || 0;
        const rest = m.poidsRestant ?? "";
        html += `
          <div class="movement-line">
            → ${fmtDate(m.createdAt)} • ${type}
            &nbsp;|&nbsp; ${poids > 0 ? "+" : ""}${poids.toFixed ? poids.toFixed(3) : poids} kg
            ${rest !== "" ? `&nbsp;|&nbsp; Reste : ${rest} kg` : ""}
          </div>
        `;
      }
    }

    html += `</div>`; // .achat-card
  }

  els.list.innerHTML = html;
}
