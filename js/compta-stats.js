// ------------------------------------------------------
// COMPTA STATS — Fournisseurs & Articles
// Source : compta_journal (journées VALIDÉES)
// Utilise :
//   - caReel, achatsConsoHT, marge
//   - achats_consommes        (par fournisseurNom)
//   - consommation_par_article (par PLU)
//   - ventes_par_article       (par PLU)
// ------------------------------------------------------

import { db } from "./firebase-init.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ---------- Utils ---------- */
function toNum(v) {
  return Number(String(v ?? 0).replace(/\s/g, "").replace(",", "."));
}
function n2(v) {
  return Number(v || 0).toFixed(2);
}
function ymd(d) {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isFinite(d) ? d : null;
}
function matchSearch(key, q) {
  if (!q) return true;
  return String(key).toLowerCase().includes(q.toLowerCase());
}

/* ---------- State global ---------- */
let fullFournisseurs = {};
let fullArticles = {};
let resumeGlobal = { ca: 0, achats: 0, marge: 0 };
let chartF = null;
let chartA = null;

/* ---------- DOM (rempli à l'init) ---------- */
let el = {};

function getRangeFromInputs() {
  const today = new Date();
  let from = parseDate(el.dateFrom.value);
  let to = parseDate(el.dateTo.value);

  if (!from) {
    from = new Date(today);
    el.dateFrom.value = ymd(from);
  }
  if (!to) {
    to = new Date(today);
    el.dateTo.value = ymd(to);
  }

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/* ------------------------------------------------------
   Charger journaux validés dans la plage de dates
------------------------------------------------------ */
async function loadJournauxInRange(from, to) {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];

  snap.forEach((d) => {
    const r = d.data();
    if (!r.validated) return;

    const dateStr = r.date || d.id; // ex: "2025-11-26"
    const dt = parseDate(dateStr);
    if (!dt) return;

    if (dt >= from && dt <= to) {
      jours.push({
        ...r,
        _date: dt,
        _dateStr: dateStr,
      });
    }
  });

  jours.sort((a, b) => a._date - b._date);
  return jours;
}

/* ------------------------------------------------------
   Agrégation Fournisseurs + Articles
------------------------------------------------------ */
function aggregateStats(jours) {
  const fournisseurs = {};
  const articles = {};

  let totalCa = 0;
  let totalAchatsConso = 0;
  let totalMarge = 0;

  for (const j of jours) {
    const caReel = toNum(j.caReel);
    const achatsConso = toNum(j.achatsConsoHT);
    const marge = toNum(j.marge);

    totalCa += caReel;
    totalAchatsConso += achatsConso;
    totalMarge += marge;

    const achatsParFour = j.achats_consommes || {};
    const achatsParArticle = j.consommation_par_article || {};
    const ventesParArticle = j.ventes_par_article || {};

    // ------- Fournisseurs -------
    const totalAchatsJour = Object.values(achatsParFour)
      .map(toNum)
      .reduce((s, v) => s + v, 0);

    for (const [four, achatVal] of Object.entries(achatsParFour)) {
      const achat = toNum(achatVal);

      // CA ventilé au prorata de l'achat consommé
      const vente =
        totalAchatsJour > 0 ? (caReel * achat) / totalAchatsJour : 0;
      const mrg = vente - achat;

      if (!fournisseurs[four]) {
        fournisseurs[four] = { vente: 0, achat: 0, marge: 0 };
      }
      fournisseurs[four].vente += vente;
      fournisseurs[four].achat += achat;
      fournisseurs[four].marge += mrg;
    }

    // ------- Articles -------
    for (const [plu, achatVal] of Object.entries(achatsParArticle)) {
      const achat = toNum(achatVal);
      const vente = toNum(ventesParArticle[plu] || 0);
      const mrg = vente - achat;

      if (!articles[plu]) {
        articles[plu] = { vente: 0, achat: 0, marge: 0 };
      }
      articles[plu].vente += vente;
      articles[plu].achat += achat;
      articles[plu].marge += mrg;
    }
  }

  resumeGlobal = {
    ca: totalCa,
    achats: totalAchatsConso,
    marge: totalMarge,
  };

  fullFournisseurs = fournisseurs;
  fullArticles = articles;
}

/* ------------------------------------------------------
   Rendu résumé
------------------------------------------------------ */
function renderResume() {
  el.resumeCa.textContent = `${n2(resumeGlobal.ca)} €`;
  el.resumeAchats.textContent = `${n2(resumeGlobal.achats)} €`;
  el.resumeMarge.textContent = `${n2(resumeGlobal.marge)} €`;
}

/* ------------------------------------------------------
   Rendu tables + graphs avec filtres de recherche
------------------------------------------------------ */
function renderTablesAndCharts() {
  const qF = el.searchF.value.trim();
  const qA = el.searchA.value.trim();

  // ------- Fournisseurs -------
  let rowsF = Object.entries(fullFournisseurs).map(([four, v]) => {
    const pct = v.vente > 0 ? (v.marge / v.vente) * 100 : 0;
    return { four, ...v, pct };
  });

  rowsF = rowsF.filter((r) => matchSearch(r.four, qF));
  rowsF.sort((a, b) => b.marge - a.marge); // top marge

  const topF = rowsF.slice(0, 10);

  el.tableF.innerHTML = topF
    .map(
      (r) => `
      <tr>
        <td>${r.four}</td>
        <td>${n2(r.vente)} €</td>
        <td>${n2(r.achat)} €</td>
        <td>${n2(r.marge)} €</td>
        <td>${n2(r.pct)}%</td>
      </tr>`
    )
    .join("");

  if (chartF) chartF.destroy();
  if (el.chartF) {
    chartF = new Chart(el.chartF, {
      type: "bar",
      data: {
        labels: topF.map((r) => r.four),
        datasets: [
          {
            label: "Marge €",
            data: topF.map((r) => r.marge),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // ------- Articles -------
  let rowsA = Object.entries(fullArticles).map(([plu, v]) => {
    const pct = v.vente > 0 ? (v.marge / v.vente) * 100 : 0;
    return { plu, ...v, pct };
  });

  rowsA = rowsA.filter((r) => matchSearch(r.plu, qA));
  rowsA.sort((a, b) => b.marge - a.marge);

  const topA = rowsA.slice(0, 10);

  el.tableA.innerHTML = topA
    .map(
      (r) => `
      <tr>
        <td>${r.plu}</td>
        <td></td>
        <td>${n2(r.vente)} €</td>
        <td>${n2(r.achat)} €</td>
        <td>${n2(r.marge)} €</td>
        <td>${n2(r.pct)}%</td>
      </tr>`
    )
    .join("");

  if (chartA) chartA.destroy();
  if (el.chartA) {
    chartA = new Chart(el.chartA, {
      type: "bar",
      data: {
        labels: topA.map((r) => r.plu),
        datasets: [
          {
            label: "Marge €",
            data: topA.map((r) => r.marge),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }
}

/* ------------------------------------------------------
   Refresh principal (charge Firestore + agrège + rend)
------------------------------------------------------ */
async function refreshStats() {
  const { from, to } = getRangeFromInputs();
  const jours = await loadJournauxInRange(from, to);

  if (!jours.length) {
    resumeGlobal = { ca: 0, achats: 0, marge: 0 };
    fullFournisseurs = {};
    fullArticles = {};
    renderResume();
    el.tableF.innerHTML = "";
    el.tableA.innerHTML = "";
    if (chartF) chartF.destroy();
    if (chartA) chartA.destroy();
    return;
  }

  aggregateStats(jours);
  renderResume();
  renderTablesAndCharts();
}

/* ------------------------------------------------------
   Boutons de période (Jour / Semaine / Mois / Année)
------------------------------------------------------ */
function initPeriodButtons() {
  const today = new Date();
  el.dateFrom.value = ymd(today);
  el.dateTo.value = ymd(today);

  el.periodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.period;
      const y = today.getFullYear();
      const m = today.getMonth();

      if (p === "day") {
        const v = ymd(today);
        el.dateFrom.value = v;
        el.dateTo.value = v;
      }

      if (p === "week") {
        const start = new Date(today);
        const day = start.getDay() || 7; // lundi=1
        if (day !== 1) start.setDate(start.getDate() - (day - 1));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        el.dateFrom.value = ymd(start);
        el.dateTo.value = ymd(end);
      }

      if (p === "month") {
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0);
        el.dateFrom.value = ymd(start);
        el.dateTo.value = ymd(end);
      }

      if (p === "year") {
        const start = new Date(y, 0, 1);
        const end = new Date(y, 11, 31);
        el.dateFrom.value = ymd(start);
        el.dateTo.value = ymd(end);
      }

      refreshStats();
    });
  });
}

/* ------------------------------------------------------
   INIT GLOBALE
------------------------------------------------------ */
function init() {
  // Récupérer les éléments DOM une fois le HTML chargé
  el = {
    dateFrom: document.getElementById("dateFrom"),
    dateTo: document.getElementById("dateTo"),
    btnLoad: document.getElementById("btnLoad"),
    periodButtons: document.querySelectorAll("button[data-period]"),

    resumeCa: document.getElementById("resume-ca"),
    resumeAchats: document.getElementById("resume-achats"),
    resumeMarge: document.getElementById("resume-marge"),

    searchF: document.getElementById("searchF"),
    searchA: document.getElementById("searchA"),

    tableF: document.getElementById("table-fournisseurs"),
    tableA: document.getElementById("table-articles"),

    chartF: document.getElementById("chartFournisseurs"),
    chartA: document.getElementById("chartArticles"),
  };

  initPeriodButtons();

  // Bouton "Charger"
  el.btnLoad.addEventListener("click", () => {
    refreshStats();
  });

  // Recherche texte
  el.searchF.addEventListener("input", () => {
    renderTablesAndCharts();
  });
  el.searchA.addEventListener("input", () => {
    renderTablesAndCharts();
  });

  // Première charge
  refreshStats();
}

window.addEventListener("DOMContentLoaded", init);
