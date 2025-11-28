// js/compta-stats.js (VERSION CORRIGEE)
import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, where, getDoc, doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ------------------------------------------------------------------
   UTILS
-------------------------------------------------------------------*/
const fmt = n => Number(n || 0).toFixed(2) + " €";
const d2 = d => d.toISOString().split("T")[0];

function toNum(v){
  const n = Number(v || 0);
  return isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------
   LOAD CA RÉEL (compta_journal)
-------------------------------------------------------------------*/
async function loadCA(from, to) {
  const col = collection(db, "compta_journal");
  const qy = query(col,
    where("date", ">=", from),
    where("date", "<=", to)
  );

  const snap = await getDocs(qy);
  let totalCA = 0;

  snap.forEach(d => {
    totalCA += Number(d.data().caReel || 0);
  });

  console.log("💰 Total CA =", totalCA);
  return totalCA;
}

/* ------------------------------------------------------------------
   LOAD MOUVEMENTS FIFO (sorties = consommations) -> filtrer côté serveur
-------------------------------------------------------------------*/
async function loadMouvements(from, to) {
  console.log("📥 Load MOVEMENTS from stock_movements (filtered)...");

  const start = new Date(from + "T00:00:00");
  const end   = new Date(to   + "T23:59:59");

  // Requête côté serveur sur createdAt pour éviter ramener toute la collection
  const col = collection(db, "stock_movements");
  let q = query(col,
    where("createdAt", ">=", start),
    where("createdAt", "<=", end)
  );

  // Fallback : si les champs createdAt ne sont pas indexables / présents,
  // on récupère tout (ancienne logique) — mais on essaie la requête d'abord.
  try {
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(doc => {
      const d = doc.data();
      // filtrage complémentaire : on veut uniquement les ventes FIFO
      if (d.sens !== "sortie") return;
      if (d.type === "inventory") return;
      if (d.type === "transformation") return;
      if (d.type === "correction") return;
      if (!d.poids || d.poids <= 0) return;
      list.push(d);
    });
    console.log(`📦 ${list.length} mouvements trouvés (requête filtered)`);
    return list;
  } catch (e) {
    console.warn("Filtering by createdAt failed, falling back to client-side filter", e);
    // fallback : récupérer tout et filtrer côté client
    const snapAll = await getDocs(collection(db, "stock_movements"));
    const list = [];
    const fromD = start;
    const toD = end;
    snapAll.forEach(doc => {
      const d = doc.data();
      if (d.sens !== "sortie") return;
      if (d.type === "inventory") return;
      if (d.type === "transformation") return;
      if (d.type === "correction") return;
      if (!d.poids || d.poids <= 0) return;

      let dt = null;
      if (d.createdAt?.toDate) dt = d.createdAt.toDate();
      else if (d.createdAt instanceof Date) dt = d.createdAt;
      if (!dt) return;
      if (dt >= fromD && dt <= toD) list.push(d);
    });
    console.log(`📦 ${list.length} mouvements trouvés (client-side)`);
    return list;
  }
}

/* ------------------------------------------------------------------
   LOAD LOTS
-------------------------------------------------------------------*/
async function loadLots() {
  const col = collection(db, "lots");
  const snap = await getDocs(col);

  const lots = {};
  snap.forEach(doc => {
    lots[doc.id] = doc.data();
  });

  console.log("📥 LOTS chargés :", Object.keys(lots).length);
  return lots;
}

/* ------------------------------------------------------------------
   LOAD ACHATS (pour récupérer fournisseur)
-------------------------------------------------------------------*/
async function loadAchats() {
  const col = collection(db, "achats");
  const snap = await getDocs(col);

  const achats = {};
  snap.forEach(doc => {
    achats[doc.id] = doc.data();
  });

  console.log("📥 ACHATS chargés :", Object.keys(achats).length);
  return achats;
}

/* ------------------------------------------------------------------
   CALCUL STATISTIQUES
-------------------------------------------------------------------*/
async function calculStats(from, to) {
  console.log("🚀 DÉBUT CALCUL STATS", from, to);

  const [ca, mouvements, lots, achats] = await Promise.all([
    loadCA(from, to),
    loadMouvements(from, to),
    loadLots(),
    loadAchats()
  ]);

  let achatsConso = 0;

  const statsFournisseurs = {};  // {fournisseurNom: {ca, achats, marge, margePct}}
  const statsArticles = {};      // {plu: {designation, ca, achats, marge, margePct}}

  for (const m of mouvements) {
    const lot = lots[m.lotId];
    if (!lot) continue;
    const achat = achats[lot.achatId] || {};
    const fournisseur = achat.fournisseurNom || achat.fournisseur || "INCONNU";

    const plu = lot.plu;
    const designation = lot.designation || "";

    const prixKg = Number(lot.prixAchatKg || 0);
    const po = Number(m.poids || 0);
    const achatHT = po * prixKg;

    achatsConso += achatHT;

    // FOURNISSEUR
    if (!statsFournisseurs[fournisseur]) statsFournisseurs[fournisseur] = { ca: 0, achats: 0, marge: 0, margePct: 0 };
    statsFournisseurs[fournisseur].achats += achatHT;

    // ARTICLE
    if (!statsArticles[plu]) statsArticles[plu] = { designation, ca: 0, achats: 0, marge: 0, margePct: 0 };
    statsArticles[plu].achats += achatHT;
  }

  // Répartir le CA total **proportionnellement** aux achats consommés
  if (achatsConso > 0) {
    for (const f in statsFournisseurs) {
      const ach = statsFournisseurs[f].achats;
      const caAlloc = ca * (ach / achatsConso);
      statsFournisseurs[f].ca = caAlloc;
      statsFournisseurs[f].marge = caAlloc - ach;
      statsFournisseurs[f].margePct = caAlloc > 0 ? (statsFournisseurs[f].marge / caAlloc * 100) : 0;
    }

    for (const p in statsArticles) {
      const ach = statsArticles[p].achats;
      const caAlloc = ca * (ach / achatsConso);
      statsArticles[p].ca = caAlloc;
      statsArticles[p].marge = caAlloc - ach;
      statsArticles[p].margePct = caAlloc > 0 ? (statsArticles[p].marge / caAlloc * 100) : 0;
    }
  } else {
    // pas d'achats consommés : tout à zéro
    for (const f in statsFournisseurs) {
      statsFournisseurs[f].ca = 0;
      statsFournisseurs[f].marge = -statsFournisseurs[f].achats; // marqué comme perte si nécessaire
      statsFournisseurs[f].margePct = 0;
    }
    for (const p in statsArticles) {
      statsArticles[p].ca = 0;
      statsArticles[p].marge = -statsArticles[p].achats;
      statsArticles[p].margePct = 0;
    }
  }

  const margeTotale = ca - achatsConso;

  const final = {
    ca,
    achats: achatsConso,
    marge: margeTotale,
    fournisseurs: statsFournisseurs,
    articles: statsArticles
  };

  console.log("📊 STATS FINALES :", final);
  return final;
}

/* ------------------------------------------------------------------
   RENDU HTML
-------------------------------------------------------------------*/
function renderStats(stats) {
  document.querySelector("#resume-ca").textContent = fmt(stats.ca);
  document.querySelector("#resume-achats").textContent = fmt(stats.achats);
  document.querySelector("#resume-marge").textContent = fmt(stats.marge);

  // FOURNISSEURS
  const tf = document.querySelector("#table-fournisseurs");
  tf.innerHTML = "";
  Object.entries(stats.fournisseurs).forEach(([name, s]) => {
    const pct = s.ca > 0 ? (s.marge / s.ca * 100).toFixed(1) : "0.0";
    tf.innerHTML += `
      <tr>
        <td>${name}</td>
        <td>${fmt(s.ca)}</td>
        <td>${fmt(s.achats)}</td>
        <td>${fmt(s.marge)}</td>
        <td>${pct}%</td>
      </tr>`;
  });

  // ARTICLES
  const ta = document.querySelector("#table-articles");
  ta.innerHTML = "";
  Object.entries(stats.articles).forEach(([plu, a]) => {
    const pct = a.ca > 0 ? (a.marge / a.ca * 100).toFixed(1) : "0.0";
    ta.innerHTML += `
      <tr>
        <td>${plu}</td>
        <td>${a.designation || ""}</td>
        <td>${fmt(a.ca)}</td>
        <td>${fmt(a.achats)}</td>
        <td>${fmt(a.marge)}</td>
        <td>${pct}%</td>
      </tr>`;
  });
}

/* Charts (Chart.js) */
function renderChartFournisseurs(fournisseurs) {
  const ctx = document.getElementById('chartFournisseurs').getContext('2d');
  const labels = Object.keys(fournisseurs);
  const data = Object.values(fournisseurs).map(f => Number(f.marge || 0));
  if (window._chartF) window._chartF.destroy();
  window._chartF = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: "Marge (€)", data }] }
  });
}

function renderChartArticles(articles) {
  const ctx = document.getElementById('chartArticles').getContext('2d');
  const labels = Object.keys(articles);
  const data = Object.values(articles).map(a => Number(a.marge || 0));
  if (window._chartA) window._chartA.destroy();
  window._chartA = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: "Marge (€)", data }] }
  });
}

/* ------------------------------------------------------------------
   BOUTONS / CHARGEMENT
-------------------------------------------------------------------*/
document.querySelector("#btnLoad").addEventListener("click", async () => {
  const from = document.querySelector("#dateFrom").value;
  const to = document.querySelector("#dateTo").value;
  if (!from || !to) {
    alert("Choisis une période valide (Du / Au).");
    return;
  }

  document.querySelector("#resume-ca").textContent = "Calcul en cours…";
  const stats = await calculStats(from, to);
  renderStats(stats);
  renderChartFournisseurs(stats.fournisseurs);
  renderChartArticles(stats.articles);
});

/* Raccourcis (jour, semaine, mois, année) */
document.querySelectorAll("[data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period;
    const now = new Date();

    let from, to;

    if (p === "day") {
      from = to = d2(now);
    } else if (p === "week") {
      const d = new Date();
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      from = d2(d);
      to = d2(new Date());
    } else if (p === "month") {
      from = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-01";
      to = d2(now);
    } else if (p === "year") {
      from = now.getFullYear() + "-01-01";
      to = d2(now);
    }
    document.querySelector("#dateFrom").value = from;
    document.querySelector("#dateTo").value = to;
    document.querySelector("#btnLoad").click();
  });
});
