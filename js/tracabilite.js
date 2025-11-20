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

  // String "2025-11-22"
  const asDate = new Date(val);
  if (!isNaN(asDate.getTime())) {
    return asDate.toLocaleDateString("fr-FR");
  }

  // Format inconnu -> on renvoie tel quel
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

// Option : charger avec un filtre par défaut (ex: 7 derniers jours)
window.addEventListener("load", () => {
  // Exemple : remplir automatiquement la date "Au" à aujourd'hui
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  els.to.value = `${yyyy}-${mm}-${dd}`;

  // Tu peux aussi mettre un "Du" par défaut (ex: -7 jours) si tu veux
  loadTraceability().catch(console.error);
});

async function loadTraceability() {
  els.btn.disabled = true;
  els.list.innerHTML = `<div class="empty-msg">Chargement…</div>`;

  const fromDate = toDateOrNull(els.from.value);
  const toDate = toDateOrNull(els.to.value);
  const pluFilter = els.plu.value.trim();
  const fournFilter = normStr(els.fourn.value.trim());
  const typeFilter = els.type.value; // all | achat | vente | transformation | inventaire

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

    // Filtre fournisseur via achat (si demandé)
    const achatInfo = await fetchAchatAndLine(lot);
    if (!achatInfo) continue; // si achat introuvable, on skip

    const { achat, ligne } = achatInfo;

    if (fournFilter) {
      const nomFourn = normStr(achat?.fournisseurNom || achat?.fournisseur || "");
      if (!nomFourn.includes(fournFilter)) {
        continue;
      }
    }

    // 3️⃣ Mouvements du lot
    const mouvements = await fetchMovementsForLot(lotId, typeFilter);

    cards.push({ lotId, lot, achat, ligne, mouvements });
  }

  if (!cards.length) {
    els.list.innerHTML = `<div class="empty-msg">Aucun résultat après filtres.</div>`;
    els.btn.disabled = false;
    return;
  }

  // 4️⃣ Affichage
  renderCards(cards, typeFilter);

  els.btn.disabled = false;
}

// -------- Fetch lots : soit par PLU, soit par dates ----------
async function fetchLots({ fromDate, toDate, pluFilter }) {
  const lotsCol = collection(db, "lots");
  let qRef;

  if (pluFilter) {
    // Si PLU renseigné : on filtre sur le PLU uniquement
    qRef = query(lotsCol, where("plu", "==", pluFilter));
  } else if (fromDate || toDate) {
    const constraints = [];
    if (fromDate) constraints.push(where("createdAt", ">=", fromDate));
    if (toDate) {
      // inclure le jour entier
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      constraints.push(where("createdAt", "<=", end));
    }
    qRef = query(lotsCol, ...constraints, orderBy("createdAt", "desc"));
  } else {
    // Pas de filtres → on prend les lots les plus récents
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
async function fetchMovementsForLot(lotId, typeFilter) {
  const col = collection(db, "stock_movements");
  // ⚠️ Cette requête (where lotId + orderBy date) peut demander un index composé
  const qRef = query(col, where("lotId", "==", lotId), orderBy("date", "asc"));
  const snap = await getDocs(qRef);

  const out = [];
  snap.forEach((doc) => {
    const m = doc.data();

    // Filtre par type si besoin (vente / transformation / inventaire)
    if (typeFilter === "vente" && m.type !== "VENTE") return;
    if (typeFilter === "transformation" && m.type !== "TRANSFORMATION") return;
    if (typeFilter === "inventaire" && !m.type?.toUpperCase().includes("INVENTAIRE")) return;

    out.push(m);
  });

  return out;
}

// -------- Affichage ----------
function renderCards(cards, typeFilter) {
    // 🔥 Tri décroissant par date d’achat
  cards.sort((a, b) => {
    const dateA =
      a.achat?.date?.toDate ? a.achat.date.toDate() :
      a.achat?.createdAt?.toDate ? a.achat.createdAt.toDate() :
      a.lot?.createdAt?.toDate ? a.lot.createdAt.toDate() :
      new Date(a.achat?.date || a.lot?.createdAt);

    const dateB =
      b.achat?.date?.toDate ? b.achat.date.toDate() :
      b.achat?.createdAt?.toDate ? b.achat.createdAt.toDate() :
      b.lot?.createdAt?.toDate ? b.lot.createdAt.toDate() :
      new Date(b.achat?.date || b.lot?.createdAt);

    return dateB - dateA; // plus récent en premier
  });

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

    // Si filtre "achat" seul → on n'affiche pas les mouvements
    if (typeFilter === "achat") {
      html += `</div>`;
      continue;
    }

    html += `<div class="movements-title">Mouvements du lot</div>`;

        if (!mouvements.length) {
      if (closed) {
        html += `<div class="no-movements">Lot consommé — aucun mouvement enregistré.</div>`;
      } else {
        html += `<div class="no-movements">Aucun mouvement encore enregistré.</div>`;
      }
    } else {
      for (const m of mouvements) {
        const type = m.type || "";
        const poids = m.poids || 0;
        const rest = m.poidsRestant ?? "";
        html += `
          <div class="movement-line">
            → ${fmtDate(m.date)} • ${type}
            &nbsp;|&nbsp; ${poids > 0 ? "+" : ""}${poids} kg
            ${rest !== "" ? `&nbsp;|&nbsp; Reste : ${rest} kg` : ""}
          </div>
        `;
      }
    }

    html += `</div>`; // .achat-card
  }

  els.list.innerHTML = html;
}
