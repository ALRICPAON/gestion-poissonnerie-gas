// -------------------------------------------------------
// COMPTA-STATS.JS
// Résumé = compta_journal (Z réel)
// Détail Fournisseurs & Articles = LOTS + STOCK (consommé)
// -------------------------------------------------------
import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  getDoc
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

function tsToYmd(v) {
  if (!v) return null;
  if (v.toDate) return ymd(v.toDate());
  if (v instanceof Date) return ymd(v);
  return ymd(v);
}

function matchSearch(text, q) {
  if (!q) return true;
  return String(text || "").toLowerCase().includes(q.toLowerCase());
}

// -------------------------------------------------------
// 1) COMPTA_JOURNAL : Résumé CA / Achats consommés / Marge
// -------------------------------------------------------
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

function computeResume(journaux) {
  let totalCA = 0;
  let totalAchatsConso = 0;
  let totalMarge = 0;

  for (const j of journaux) {
    const ca   = Number(j.caReel || 0);
    const ach  = Number(j.achatsConsoHT || 0);
    const marg = (j.marge != null)
      ? Number(j.marge)
      : ca - ach;

    totalCA          += ca;
    totalAchatsConso += ach;
    totalMarge       += marg;
  }

  return { totalCA, totalAchatsConso, totalMarge };
}

function renderResume(totalCA, totalAchatsConso, totalMarge) {
  resumeCA.textContent     = fmtMoney(totalCA);
  resumeAchats.textContent = fmtMoney(totalAchatsConso);

  const pct = totalCA > 0 ? (totalMarge / totalCA) * 100 : 0;
  resumeMarge.textContent  = `${fmtMoney(totalMarge)} (${n2(pct)}%)`;
}

// -------------------------------------------------------
// 2) LOTS + STOCK : Fournisseurs & Articles (consommation réelle)
// -------------------------------------------------------

// Charge tous les lots dans la période (par date de création du lot)
async function loadLotsInPeriod(from = null, to = null) {
  const snap = await getDocs(collection(db, "lots"));
  const res = [];
  const hasRange = !!(from && to);

  snap.forEach(d => {
    const r = d.data();

    // On ne s'intéresse qu'aux lots issus d'un achat
    if (r.source && r.source !== "achat") return;

    const dstr = tsToYmd(r.createdAt || r.updatedAt);
    if (!dstr) return;

    if (hasRange) {
      if (dstr < from || dstr > to) return;
    }

    res.push({
      ...r,
      _dateStr: dstr
    });
  });

  return res;
}

// Charge la map achatId -> fournisseurNom
async function loadAchatsMap(achatIds) {
  const map = {};
  for (const id of achatIds) {
    try {
      const ref = doc(db, "achats", id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        map[id] = {
          fournisseurNom: data.fournisseurNom || "Inconnu"
        };
      }
    } catch (e) {
      console.error("Erreur getDoc achats", id, e);
    }
  }
  return map;
}

// Charge la map PLU -> pvTTCreel (+ désignation si dispo)
async function loadStockArticlesMap() {
  const snap = await getDocs(collection(db, "stock_articles"));
  const map = {};
  snap.forEach(d => {
    const data = d.data();
    const id   = d.id; // ex: "PLU_2001"
    const plu  = id.startsWith("PLU_") ? id.slice(4) : id;
    map[plu] = {
      pvTTCreel: Number(data.pvTTCreel || 0),
      designation: data.designation || ""
    };
  });
  return map;
}

// Calcule les stats Fournisseurs & Articles à partir des lots
// ⚠️ Ici on travaille sur la CONSOMMATION réelle : poidsConsomme = poidsInitial - poidsRestant
function computeStatsFromLots(lots, achatsMap, stockMap) {
  const fournisseurs = {}; // { fournisseurNom: { achatsHT, ca, marge, poidsConsomme } }
  const articles = {};     // { plu: { designation, achatsHT, ca, marge, poidsConsomme } }

  for (const lot of lots) {
    const plu          = lot.plu || "???";
    const achatId      = lot.achatId || null;
    const fournisseur  =
      (achatId && achatsMap[achatId]?.fournisseurNom) || "Inconnu";

    const prixAchatKg  = Number(lot.prixAchatKg || 0);
    const poidsInitial = Number(lot.poidsInitial || 0);
    const poidsRestant = Number(lot.poidsRestant || 0);

    // 💡 Consommé réel = ce qui est parti du stock
    const poidsConsomme = Math.max(0, poidsInitial - poidsRestant);
    if (poidsConsomme <= 0) {
      // Rien consommé sur ce lot → pas d'impact sur la marge de la période
      continue;
    }

    const pvTTCreel    = Number(stockMap[plu]?.pvTTCreel || 0);
    const designation  =
      lot.designation || stockMap[plu]?.designation || "";

    const achatsHT     = poidsConsomme * prixAchatKg;
    const ca           = poidsConsomme * pvTTCreel;
    const marge        = ca - achatsHT;

    // ---- Fournisseurs ----
    if (!fournisseurs[fournisseur]) {
      fournisseurs[fournisseur] = {
        achatsHT: 0,
        ca: 0,
        marge: 0,
        poidsConsomme: 0
      };
    }
    const f = fournisseurs[fournisseur];
    f.achatsHT      += achatsHT;
    f.ca            += ca;
    f.marge         += marge;
    f.poidsConsomme += poidsConsomme;

    // ---- Articles ----
    if (!articles[plu]) {
      articles[plu] = {
        plu,
        designation,
        achatsHT: 0,
        ca: 0,
        marge: 0,
        poidsConsomme: 0
      };
    }
    const a = articles[plu];
    a.achatsHT      += achatsHT;
    a.ca            += ca;
    a.marge         += marge;
    a.poidsConsomme += poidsConsomme;
  }

  return { fournisseurs, articles };
}

// -------------------------------------------------------
// 3) AFFICHAGE TABLEAUX + GRAPHIQUES
// -------------------------------------------------------
function renderTablesAndCharts(fournisseurs, articles) {
  const qF = (searchF.value || "").trim().toLowerCase();
  const qA = (searchA.value || "").trim().toLowerCase();

  // ----- Fournisseurs -----
  let entriesF = Object.entries(fournisseurs);

  // tri par marge décroissante
  entriesF.sort(([, a], [, b]) => b.marge - a.marge);

  // filtre recherche
  entriesF = entriesF.filter(([name]) => matchSearch(name, qF));

  const topF = entriesF.slice(0, 10);

  tbodyF.innerHTML = topF
    .map(([name, v]) => {
      const pct = v.ca > 0 ? (v.marge / v.ca) * 100 : 0;
      return `<tr>
        <td>${name}</td>
        <td>${fmtMoney(v.ca)}</td>
        <td>${fmtMoney(v.achatsHT)}</td>
        <td>${fmtMoney(v.marge)}</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    })
    .join("");

  // Chart Fournisseurs (marge)
  try {
    const ctxF = document.getElementById("chartFournisseurs").getContext("2d");
    if (chartF) chartF.destroy();
    chartF = new Chart(ctxF, {
      type: "bar",
      data: {
        labels: topF.map(([name]) => name),
        datasets: [
          {
            label: "Marge € (consommé)",
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
        <td>${fmtMoney(v.achatsHT)}</td>
        <td>${fmtMoney(v.marge)}</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    })
    .join("");

  // Chart Articles (marge)
  try {
    const ctxA = document.getElementById("chartArticles").getContext("2d");
    if (chartA) chartA.destroy();
    chartA = new Chart(ctxA, {
      type: "bar",
      data: {
        labels: topA.map(([, v]) => v.plu),
        datasets: [
          {
            label: "Marge € (consommé)",
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

// -------------------------------------------------------
// 4) RAFRAÎCHISSEMENT GLOBAL
// -------------------------------------------------------
async function refreshStats() {
  try {
    const from = dateFrom.value || null;
    const to   = dateTo.value || null;

    // Résumé compta_journal (Z réel + achats consommés)
    const journaux = await loadJournaux(from, to);
    const { totalCA, totalAchatsConso, totalMarge } = computeResume(journaux);
    renderResume(totalCA, totalAchatsConso, totalMarge);

    // Détail Fournisseurs / Articles via LOTS + STOCK (consommé)
    const lots = await loadLotsInPeriod(from, to);

    const achatIds = Array.from(
      new Set(
        lots.map(l => l.achatId).filter(Boolean)
      )
    );

    const [achatsMap, stockMap] = await Promise.all([
      loadAchatsMap(achatIds),
      loadStockArticlesMap()
    ]);

    const { fournisseurs, articles } = computeStatsFromLots(lots, achatsMap, stockMap);

    renderTablesAndCharts(fournisseurs, articles);
  } catch (e) {
    console.error("Erreur refreshStats :", e);
    alert("Erreur lors du chargement des statistiques (voir console).");
  }
}

// -------------------------------------------------------
// 5) ÉVÈNEMENTS
// -------------------------------------------------------

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
