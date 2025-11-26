// -------------------------------------------------------
// COMPTA-STATS.JS
// Stats Fournisseurs & Articles basées sur LOTS + STOCK
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

// Charts (optionnel)
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

// ---------- Chargement des données de base ----------

// Charge tous les prix de vente (stock_articles)
async function loadStockArticlesMap() {
  const snap = await getDocs(collection(db, "stock_articles"));
  const map = {};
  snap.forEach(d => {
    const data = d.data();
    const id = d.id;            // ex: "PLU_2001"
    const plu = id.startsWith("PLU_") ? id.slice(4) : id;
    map[plu] = {
      pvTTCreel: Number(data.pvTTCreel || 0)
    };
  });
  return map;
}

// Charge les achats (uniquement ceux utilisés)
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

// Charge les lots dans la période
async function loadLotsInPeriod(from, to) {
  const snap = await getDocs(collection(db, "lots"));
  const res = [];

  const hasRange = !!(from && to);

  snap.forEach(d => {
    const r = d.data();

    // on ne garde que les lots issus d'un achat
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

// ---------- CALCUL DES STATS ----------
async function computeStats(from, to) {
  // 1) Charger les lots filtrés par période
  const lots = await loadLotsInPeriod(from, to);
  if (!lots.length) {
    console.warn("Aucun lot dans la période");
  }

  // 2) Construire la liste des achatId utilisés
  const achatIds = Array.from(
    new Set(
      lots
        .map(l => l.achatId)
        .filter(Boolean)
    )
  );

  // 3) Charger fournisseurs (achats) + prix vente (stock_articles)
  const [achatsMap, stockMap] = await Promise.all([
    loadAchatsMap(achatIds),
    loadStockArticlesMap()
  ]);

  // 4) Agrégations
  const statsFournisseurs = {}; // { fournisseurNom: { achats, ca, marge } }
  const statsArticles = {};     // { plu: { designation, achats, poidsAchat, poidsVendu, ca, marge } }

  let totalAchats = 0;
  let totalCA = 0;
  let totalMarge = 0;

  for (const lot of lots) {
    const plu  = lot.plu || "???";
    const designation = lot.designation || "";
    const achatId = lot.achatId || null;

    const fournisseurNom =
      (achatId && achatsMap[achatId]?.fournisseurNom) || "Inconnu";

    const prixAchatKg = Number(lot.prixAchatKg || 0);
    const poidsInitial = Number(lot.poidsInitial || 0);
    const poidsRestant = Number(lot.poidsRestant || 0);
    const poidsVendu = Math.max(0, poidsInitial - poidsRestant);

    const pvTTCreel = Number(stockMap[plu]?.pvTTCreel || 0);

    const achats = poidsInitial * prixAchatKg;
    const ca = poidsVendu * pvTTCreel;
    const marge = ca - achats;

    totalAchats += achats;
    totalCA += ca;
    totalMarge += marge;

    // Fournisseur
    if (!statsFournisseurs[fournisseurNom]) {
      statsFournisseurs[fournisseurNom] = {
        achats: 0,
        ca: 0,
        marge: 0
      };
    }
    statsFournisseurs[fournisseurNom].achats += achats;
    statsFournisseurs[fournisseurNom].ca += ca;
    statsFournisseurs[fournisseurNom].marge += marge;

    // Article
    if (!statsArticles[plu]) {
      statsArticles[plu] = {
        plu,
        designation,
        achats: 0,
        poidsAchat: 0,
        poidsVendu: 0,
        ca: 0,
        marge: 0
      };
    }
    const sa = statsArticles[plu];
    sa.achats += achats;
    sa.poidsAchat += poidsInitial;
    sa.poidsVendu += poidsVendu;
    sa.ca += ca;
    sa.marge += marge;
  }

  return {
    totalAchats,
    totalCA,
    totalMarge,
    statsFournisseurs,
    statsArticles
  };
}

// ---------- AFFICHAGE ----------
function renderResume(totalAchats, totalCA, totalMarge) {
  resumeCA.textContent = fmtMoney(totalCA);
  resumeAchats.textContent = fmtMoney(totalAchats);

  const pct = totalCA > 0 ? (totalMarge / totalCA) * 100 : 0;
  resumeMarge.textContent =
    `${fmtMoney(totalMarge)} (${n2(pct)}%)`;
}

function renderTablesAndCharts(data) {
  const qF = (searchF.value || "").trim().toLowerCase();
  const qA = (searchA.value || "").trim().toLowerCase();

  // ----- Fournisseurs -----
  let entriesF = Object.entries(data.statsFournisseurs);

  entriesF.sort(([, a], [, b]) => b.marge - a.marge); // tri marge décroissante
  entriesF = entriesF.filter(([name]) =>
    !qF || name.toLowerCase().includes(qF)
  );

  const topF = entriesF.slice(0, 10);

  tbodyF.innerHTML = topF
    .map(([name, v]) => {
      const pct = v.ca > 0 ? (v.marge / v.ca) * 100 : 0;
      return `<tr>
        <td>${name}</td>
        <td>${fmtMoney(v.ca)}</td>
        <td>${fmtMoney(v.achats)}</td>
        <td>${fmtMoney(v.marge)}</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    })
    .join("");

  // Chart fournisseurs (marge)
  try {
    const ctxF = document
      .getElementById("chartFournisseurs")
      .getContext("2d");

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
    console.warn("Chart fournisseurs erreur :", e);
  }

  // ----- Articles -----
  let entriesA = Object.entries(data.statsArticles);

  entriesA.sort(([, a], [, b]) => b.marge - a.marge);
  entriesA = entriesA.filter(([, v]) => {
    const txt = (v.plu + " " + (v.designation || "")).toLowerCase();
    return !qA || txt.includes(qA);
  });

  const topA = entriesA.slice(0, 10);

  tbodyA.innerHTML = topA
    .map(([, v]) => {
      const pct = v.ca > 0 ? (v.marge / v.ca) * 100 : 0;
      return `<tr>
        <td>${v.plu}</td>
        <td>${v.designation || ""}</td>
        <td>${fmtMoney(v.ca)}</td>
        <td>${fmtMoney(v.achats)}</td>
        <td>${fmtMoney(v.marge)}</td>
        <td>${n2(pct)}%</td>
      </tr>`;
    })
    .join("");

  // Chart articles (marge)
  try {
    const ctxA = document
      .getElementById("chartArticles")
      .getContext("2d");

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
    console.warn("Chart articles erreur :", e);
  }
}

// ---------- RAFRAÎCHISSEMENT GLOBAL ----------
async function refreshStats() {
  try {
    const from = dateFrom.value || null;
    const to = dateTo.value || null;

    const data = await computeStats(from, to);
    renderResume(data.totalAchats, data.totalCA, data.totalMarge);
    renderTablesAndCharts(data);
  } catch (e) {
    console.error("Erreur refreshStats :", e);
    alert("Erreur lors du chargement des statistiques (voir console).");
  }
}

// ---------- ÉVÈNEMENTS ----------

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

// Bouton "Charger"
btnLoad.addEventListener("click", () => {
  refreshStats();
});

// Recherche live
searchF.addEventListener("input", () => refreshStats());
searchA.addEventListener("input", () => refreshStats());

// Premier chargement : par défaut, 1 semaine
window.addEventListener("load", () => {
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - 6);
  dateFrom.value = ymd(d);
  dateTo.value = ymd(now);
  refreshStats();
});
