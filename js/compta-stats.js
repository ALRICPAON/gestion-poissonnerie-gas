// -------------------------------------------------------
// compta-stats.js — Version corrigée
// -------------------------------------------------------
import { db } from "./firebase-init.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ----- Sélecteurs -----
const elSearchF = document.getElementById("searchF");
const elSearchA = document.getElementById("searchA");
const btnLoad = document.getElementById("btnLoad");
const dateFrom = document.getElementById("dateFrom");
const dateTo = document.getElementById("dateTo");

// Boutons rapides
const btnPeriods = document.querySelectorAll("[data-period]");

// ----- Utils -----
function ymd(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}
function n2(v) {
  return Number(v || 0).toFixed(2);
}
function toNum(v) {
  const x = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(x) ? x : 0;
}
function matchSearch(key, q) {
  return !q || key.toLowerCase().includes(q.toLowerCase());
}

// ----- Chargement compta_journal -----
async function loadJournaux(from = null, to = null) {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];

  snap.forEach(doc => {
    const r = doc.data();
    if (!r.validated) return;

    const d = r.date || r.jour || r.dateISO;

    if (from && to) {
      if (d < from || d > to) return;
    }

    jours.push(r);
  });

  return jours;
}

// ----- Agrégations -----
function aggregateStats(journaux, search = "") {
  const fournisseurs = {};
  const articles = {};

  for (const j of journaux) {
    // Fournisseurs
    for (const [four, achat] of Object.entries(j.achats_consommes || {})) {
      if (!matchSearch(four, search)) continue;

      const vente = j.caReel * (achat / j.achatsConsoHT);
      const marge = vente - achat;

      if (!fournisseurs[four]) fournisseurs[four] = { achat: 0, vente: 0, marge: 0 };
      fournisseurs[four].achat += achat;
      fournisseurs[four].vente += vente;
      fournisseurs[four].marge += marge;
    }

    // Articles
    for (const [plu, achat] of Object.entries(j.consommation_par_article || {})) {
      if (!matchSearch(plu, search)) continue;

      const vente = toNum(j.ventes_par_article?.[plu] || 0);
      const marge = vente - achat;

      if (!articles[plu]) articles[plu] = { achat: 0, vente: 0, marge: 0 };
      articles[plu].achat += achat;
      articles[plu].vente += vente;
      articles[plu].marge += marge;
    }
  }

  return { fournisseurs, articles };
}

// ----- Affichage -----
async function refreshStats() {
  const from = dateFrom.value;
  const to = dateTo.value;

  const journaux = await loadJournaux(from, to);

  const { fournisseurs } = aggregateStats(journaux, elSearchF.value.trim());
  const { articles } = aggregateStats(journaux, elSearchA.value.trim());

  // Table Fournisseurs
  document.getElementById("table-fournisseurs").innerHTML =
    Object.entries(fournisseurs).map(([four, val]) => {
      const pct = val.vente > 0 ? (val.marge / val.vente * 100) : 0;
      return `<tr>
        <td>${four}</td>
        <td>${n2(val.vente)} €</td>
        <td>${n2(val.achat)} €</td>
        <td>${n2(val.marge)} €</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    }).join("");

  // Table Articles
  document.getElementById("table-articles").innerHTML =
    Object.entries(articles).map(([plu, val]) => {
      const pct = val.vente > 0 ? (val.marge / val.vente * 100) : 0;
      return `<tr>
        <td>${plu}</td>
        <td></td>
        <td>${n2(val.vente)} €</td>
        <td>${n2(val.achat)} €</td>
        <td>${n2(val.marge)} €</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    }).join("");
}

// ----- Boutons rapides -----
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
      dateTo.value = ymd(now);
    } else if (p === "month") {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      dateFrom.value = ymd(d);
      dateTo.value = ymd(now);
    } else if (p === "year") {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      dateFrom.value = ymd(d);
      dateTo.value = ymd(now);
    }

    refreshStats();
  });
});

// Chargement manuel
btnLoad.addEventListener("click", refreshStats);

// Filtre recherche
elSearchF.addEventListener("input", refreshStats);
elSearchA.addEventListener("input", refreshStats);

// Premier chargement
window.addEventListener("load", refreshStats);
