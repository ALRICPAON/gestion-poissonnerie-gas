// ------------------------------------------------------------
// STATS POISSONNERIE – Version 100% FIABLE
// ------------------------------------------------------------
import { db } from "./firebase-init.js";
import {
  collection, getDocs, doc, getDoc, query, where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const elFrom = document.getElementById("dateFrom");
const elTo = document.getElementById("dateTo");
const elBtnLoad = document.getElementById("btnLoad");

const elSearchF = document.getElementById("searchF");
const elSearchA = document.getElementById("searchA");

const elCA = document.getElementById("resume-ca");
const elAchats = document.getElementById("resume-achats");
const elMarge = document.getElementById("resume-marge");

const tbodyF = document.getElementById("table-fournisseurs");
const tbodyA = document.getElementById("table-articles");

function toNum(v) { return Number(v || 0); }
function n2(v) { return Number(v || 0).toFixed(2); }

// ------------------------------------------------------------
// 1) CHARGER JOURNEES VALIDÉES DANS LA PÉRIODE
// ------------------------------------------------------------
async function loadJournaux(from, to) {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];

  snap.forEach(d => {
    const r = d.data();
    if (!r.validated) return;

    const dt = new Date(r.date);
    if (dt >= from && dt <= to) jours.push(r);
  });

  return jours;
}

// ------------------------------------------------------------
// 2) LOAD MOUVEMENTS FIFO
// ------------------------------------------------------------
async function loadMouvements(fromStr, toStr) {
  const snap = await getDocs(collection(db, "stock_movements"));
  const rows = [];

  snap.forEach(d => {
    const r = d.data();
    if (r.type !== "consume") return;
    if (r.date < fromStr || r.date > toStr) return;

    rows.push(r);
  });

  return rows;
}

// ------------------------------------------------------------
// 3) LOAD LOTS (pour récupérer PLU, fournisseur, prix/kg…)
// ------------------------------------------------------------
async function loadLotsMap() {
  const snap = await getDocs(collection(db, "lots"));
  const map = {};

  snap.forEach(d => {
    const r = d.data();
    map[r.lotId] = r;
  });

  return map;
}

// ------------------------------------------------------------
// 4) CALCULER STATISTIQUES
// ------------------------------------------------------------
async function refreshStats() {
  const from = new Date(elFrom.value);
  from.setHours(0,0,0,0);
  const to = new Date(elTo.value);
  to.setHours(23,59,59,999);

  const fromStr = elFrom.value;
  const toStr = elTo.value;

  const jours = await loadJournaux(from, to);
  const mouvements = await loadMouvements(fromStr, toStr);
  const lots = await loadLotsMap();

  // Résumés globaux
  const SUM_CA = jours.reduce((s,j)=> s + toNum(j.caReel), 0);
  const SUM_ACH = jours.reduce((s,j)=> s + toNum(j.achatsConsoHT), 0);
  const SUM_MARGE = SUM_CA - SUM_ACH;

  elCA.textContent = n2(SUM_CA)+" €";
  elAchats.textContent = n2(SUM_ACH)+" €";
  elMarge.textContent = n2(SUM_MARGE)+" €";

  // TABLEAUX
  const fournisseurs = {};
  const articles = {};

  // Parcours mouvements (vagues FIFO)
  for (const m of mouvements) {
    const lot = lots[m.lotId];
    if (!lot) continue;

    const poids = toNum(m.poids);
    const achatHT = poids * toNum(lot.prixAchatKg);
    const plu = lot.plu || "INCONNU";
    const fournisseur = lot.fournisseurRef || "INCONNU";

    // --------------------- FOURNISSEUR ----------------------
    if (!fournisseurs[fournisseur]) {
      fournisseurs[fournisseur] = { achat:0, vente:0, marge:0 };
    }
    fournisseurs[fournisseur].achat += achatHT;

    // --------------------- ARTICLE --------------------------
    if (!articles[plu]) {
      articles[plu] = {
        designation: lot.designation || "",
        achat: 0,
        vente: 0,
        marge: 0
      };
    }
    articles[plu].achat += achatHT;
  }

  // ----------------- RÉPARTITION CA PAR ARTICLE ---------------
  // CA réel réparti proportionnellement au montant d’achat consommé
  const totalAchats = Object.values(articles).reduce((s, a) => s + a.achat, 0);

  for (const plu of Object.keys(articles)) {
    const A = articles[plu];
    const part = totalAchats > 0 ? (A.achat / totalAchats) : 0;
    A.vente = SUM_CA * part;
    A.marge = A.vente - A.achat;
  }

  for (const f of Object.keys(fournisseurs)) {
    const ach = fournisseurs[f].achat;
    const part = totalAchats > 0 ? (ach / totalAchats) : 0;
    fournisseurs[f].vente = SUM_CA * part;
    fournisseurs[f].marge = fournisseurs[f].vente - fournisseurs[f].achat;
  }

  renderTableFournisseurs(fournisseurs);
  renderTableArticles(articles);
}

// ------------------------------------------------------------
// TABLE FOURNISSEURS
// ------------------------------------------------------------
function renderTableFournisseurs(data) {
  const q = elSearchF.value.trim().toLowerCase();

  const rows = Object.entries(data)
    .filter(([name]) => !q || name.toLowerCase().includes(q))
    .map(([name, v]) => {
      const pct = v.vente > 0 ? (v.marge / v.vente * 100) : 0;
      return `
        <tr>
          <td>${name}</td>
          <td>${n2(v.vente)} €</td>
          <td>${n2(v.achat)} €</td>
          <td>${n2(v.marge)} €</td>
          <td>${n2(pct)}%</td>
        </tr>
      `;
    })
    .join("");

  tbodyF.innerHTML = rows;
}

// ------------------------------------------------------------
// TABLE ARTICLES
// ------------------------------------------------------------
function renderTableArticles(data) {
  const q = elSearchA.value.trim().toLowerCase();

  const rows = Object.entries(data)
    .filter(([plu, v]) =>
      !q ||
      plu.includes(q) ||
      (v.designation || "").toLowerCase().includes(q)
    )
    .map(([plu, v]) => {
      const pct = v.vente > 0 ? (v.marge / v.vente * 100) : 0;
      return `
        <tr>
          <td>${plu}</td>
          <td>${v.designation}</td>
          <td>${n2(v.vente)} €</td>
          <td>${n2(v.achat)} €</td>
          <td>${n2(v.marge)} €</td>
          <td>${n2(pct)}%</td>
        </tr>
      `;
    })
    .join("");

  tbodyA.innerHTML = rows;
}

// ------------------------------------------------------------
// BOUTONS RAPIDES
// ------------------------------------------------------------
function setToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");

  elFrom.value = `${y}-${m}-${dd}`;
  elTo.value = `${y}-${m}-${dd}`;
}

document.querySelectorAll("button[data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period;
    const today = new Date();

    if (p === "day") setToday();

    if (p === "week") {
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay() + 1);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      elFrom.value = start.toISOString().slice(0,10);
      elTo.value = end.toISOString().slice(0,10);
    }

    if (p === "month") {
      const y = today.getFullYear();
      const m = today.getMonth()+1;
      elFrom.value = `${y}-${String(m).padStart(2,"0")}-01`;
      const end = new Date(y, m, 0);
      elTo.value = end.toISOString().slice(0,10);
    }

    if (p === "year") {
      const y = today.getFullYear();
      elFrom.value = `${y}-01-01`;
      elTo.value = `${y}-12-31`;
    }

    refreshStats();
  });
});

// Bouton Charger
elBtnLoad.addEventListener("click", refreshStats);

// Recherche live
elSearchF.addEventListener("input", refreshStats);
elSearchA.addEventListener("input", refreshStats);

// INIT
setToday();
refreshStats();
