// -------------------------------------------------------
// COMPTA-STATS.JS
// Stats basées sur COMPTA_JOURNAL (réel : Z + lots)
// -------------------------------------------------------
import { db } from "./firebase-init.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ---------- Sélecteurs DOM ----------
const dateFrom   = document.getElementById("dateFrom");
const dateTo     = document.getElementById("dateTo");
const btnLoad    = document.getElementById("btnLoad");
const btnPeriods = document.querySelectorAll("[data-period]");

const searchF = document.getElementById("searchF");
const searchA = document.getElementById("searchA");

const tbodyF  = document.getElementById("table-fournisseurs");
const tbodyA  = document.getElementById("table-articles");

const resumeCA      = document.getElementById("resume-ca");
const resumeAchats  = document.getElementById("resume-achats");
const resumeMarge   = document.getElementById("resume-marge");

// Charts
let chartF = null;
let chartA = null;

// ---------- Utils ----------
const fmtMoney = (n) =>
  Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const n2 = (v) => Number(v || 0).toFixed(2);

function ymd(date) {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function matchSearch(text, q) {
  if (!q) return true;
  return String(text || "").toLowerCase().includes(q.toLowerCase());
}

// ---------- Chargement des journaux ----------
async function loadJournaux(from = null, to = null) {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];

  const hasRange = !!(from && to);

  snap.forEach(docSnap => {
    const r = docSnap.data();
    if (!r.validated) return;

    const dstr = r.date; // "YYYY-MM-DD"
    if (!dstr) return;

    if (hasRange) {
      if (dstr < from || dstr > to) return;
    }

    jours.push(r);
  });

  return jours;
}

// ---------- Calcul global ----------
function computeAggregates(journaux) {
  let totalCA = 0;
  let totalAchatsConso = 0;
  let totalMarge = 0;

  for (const j of journaux) {
    totalCA          += Number(j.caReel || 0);
    totalAchatsConso += Number(j.achatsConsoHT || 0);
    // on additionne la marge déjà calculée (réelle)
    totalMarge       += Number(j.marge || (j.caReel || 0) - (j.achatsConsoHT || 0));
  }

  return { totalCA, totalAchatsConso, totalMarge };
}

// ---------- Stats Fournisseurs & Articles ----------
function computeStats(journaux) {
  const fournisseurs = {}; // { nom: { achatsConso, ca, marge } }
  const articles = {};     // { plu: { achatConso, ca, marge } }

  for (const j of journaux) {
    const caReel        = Number(j.caReel || 0);
    const achatsConsoHT = Number(j.achatsConsoHT || 0);

    const mapF = j.achats_consommes || {};
    const mapConsoArt = j.consommation_par_article || {};
    const mapVentesArt = j.ventes_par_article || {};

    // ----- Fournisseurs -----
    for (const [four, achatConso] of Object.entries(mapF)) {
      const a = Number(achatConso || 0);
      if (a <= 0) continue;

      // Répartition CA au prorata de la consommation de ce fournisseur
      const caFour = (achatsConsoHT > 0)
        ? caReel * (a / achatsConsoHT)
        : 0;
      const margeFour = caFour - a;

      if (!fournisseurs[four]) {
        fournisseurs[four] = { achatsConso: 0, ca: 0, marge: 0 };
      }
      fournisseurs[four].achatsConso += a;
      fournisseurs[four].ca          += caFour;
      fournisseurs[four].marge       += margeFour;
    }

    // ----- Articles -----
    // On prend l'union des PLU présents dans conso ou ventes
    const allPlus = new Set([
      ...Object.keys(mapConsoArt),
      ...Object.keys(mapVentesArt)
    ]);

    for (const plu of allPlus) {
      const achatConso = Number(mapConsoArt[plu] || 0);
      const caArt      = Number(mapVentesArt[plu] || 0);
      const margeArt   = caArt - achatConso;

      if (!articles[plu]) {
        articles[plu] = {
          plu,
          designation: "", // à enrichir plus tard depuis la collection articles/stock_articles
          achatConso: 0,
          ca: 0,
          marge: 0
        };
      }
      const a = articles[plu];
      a.achatConso += achatConso;
      a.ca         += caArt;
      a.marge      += margeArt;
    }
  }

  return { fournisseurs, articles };
}

// ---------- Affichage résumé ----------
function renderResume(totalCA, totalAchatsConso, totalMarge) {
  resumeCA.textContent     = fmtMoney(totalCA);
  resumeAchats.textContent = fmtMoney(totalAchatsConso);

  const pct = totalCA > 0 ? (totalMarge / totalCA) * 100 : 0;
  resumeMarge.textContent  = `${fmtMoney(totalMarge)} (${n2(pct)}%)`;
}

// ---------- Affichage tableaux + graphiques ----------
function renderTablesAndCharts(fournisseurs, articles) {
  const qF = (searchF.value || "").trim().toLowerCase();
  const qA = (searchA.value || "").trim().toLowerCase();

  // ----- Fournisseurs -----
  let entriesF = Object.entries(fournisseurs);

  // tri par marge décroissante
  entriesF.sort(([, a], [, b]) => b.marge - a.marge);

  // filtre recherche
  entriesF = entriesF.filter(([name]) => matchSearch(name, qF));

  // top 10
  const topF = entriesF.slice(0, 10);

  tbodyF.innerHTML = topF
    .map(([name, v]) => {
      const pct = v.ca > 0 ? (v.marge / v.ca) * 100 : 0;
      return `<tr>
        <td>${name}</td>
        <td>${fmtMoney(v.ca)}</td>
        <td>${fmtMoney(v.achatsConso)}</td>
        <td>${fmtMoney(v.marge)}</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    })
    .join("");

  // Graphique Fournisseurs (marge)
  try {
    const ctxF = document.getElementById("chartFournisseurs").getContext("2d");
    if (chartF) chartF.destroy();
    chartF = new Chart(ctxF, {
      type: "bar",
      data: {
        labels: topF.map(([name]) => name),
        datasets: [
          {
            label: "Marge €",
            data: topF.map(([, v]) => Number(v.marge || 0))
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  } catch (e) {
    console.warn("Chart Fournisseurs :", e);
  }

  // ----- Articles -----
  let entriesA = Object.entries(articles);

  // tri par marge décroissante
  entriesA.sort(([, a], [, b]) => b.marge - a.marge);

  // filtre recherche (PLU + désignation)
  entriesA = entriesA.filter(([, v]) =>
    matchSearch(v.plu + " " + (v.designation || ""), qA)
  );

  const topA = entriesA.slice(0, 10);

  tbodyA.innerHTML = topA
    .map(([, v]) => {
      const pct = v.ca > 0 ? (v.marge / v.ca) * 100 : 0;
      return `<tr>
        <td>${v.plu}</td>
        <td>${v.designation || ""}</td>
        <td>${fmtMoney(v.ca)}</td>
        <td>${fmtMoney(v.achatConso)}</td>
        <td>${fmtMoney(v.marge)}</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    })
    .join("");

  // Graphique Articles (marge)
  try {
    const ctxA = document.getElementById("chartArticles").getContext("2d");
    if (chartA) chartA.destroy();
    chartA = new Chart(ctxA, {
      type: "bar",
      data: {
        labels: topA.map(([, v]) => v.plu),
        datasets: [
          {
            label: "Marge €",
            data: topA.map(([, v]) => Number(v.marge || 0))
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  } catch (e) {
    console.warn("Chart Articles :", e);
  }
}

// ---------- Rafraîchissement global ----------
async function refreshStats() {
  try {
    const from = dateFrom.value || null;
    const to   = dateTo.value || null;

    const journaux = await loadJournaux(from, to);

    const { totalCA, totalAchatsConso, totalMarge } =
      computeAggregates(journaux);

    const { fournisseurs, articles } = computeStats(journaux);

    renderResume(totalCA, totalAchatsConso, totalMarge);
    renderTablesAndCharts(fournisseurs, articles);
  } catch (e) {
    console.error("Erreur refreshStats :", e);
    alert("Erreur lors du chargement des statistiques (voir console).");
  }
}

// ---------- Évènements ----------

// Boutons rapides (Jour / Semaine / Mois / Année)
btnPeriods.forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period;
    const now = new Date();

    if (p === "day") {
      dateFrom.value = dateTo.value = ymd(now);
    } else if (p === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      dateFrom.value = ymd(d);
      dateTo.value   = ymd(now);
    } else if (p === "month") {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      dateFrom.value = ymd(d);
      dateTo.value   = ymd(now);
    } else if (p === "year") {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      dateFrom.value = ymd(d);
      dateTo.value   = ymd(now);
    }

    refreshStats();
  });
});

// Bouton "Charger"
btnLoad.addEventListener("click", () => {
  refreshStats();
});

// Recherche live
searchF.addEventListener("input", () => refreshStats());
searchA.addEventListener("input", () => refreshStats());

// Premier chargement : par défaut 1 semaine
window.addEventListener("load", () => {
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - 6);
  dateFrom.value = ymd(d);
  dateTo.value   = ymd(now);
  refreshStats();
});
