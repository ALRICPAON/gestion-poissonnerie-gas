// ------------------------------------------------------
// COMPTA STATS — VERSION FINALISÉE
// Applique EXACTEMENT la logique du tableau de bord,
// mais ventilée par fournisseur + par PLU
// ------------------------------------------------------

import { db } from "./firebase-init.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const elSearchF = document.getElementById("searchF");
const elSearchA = document.getElementById("searchA");


/* ---------------- Utils ---------------- */
const toNum = v => Number(String(v || 0).replace(",", "."));
const n2 = v => Number(v || 0).toFixed(2);


/* ------------------------------------------------------
   1) Charger journaux validés (ta source officielle CA)
------------------------------------------------------ */
async function loadJournaux() {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];

  snap.forEach(d => {
    const r = d.data();
    if (!r.validated) return;
    jours.push(r);
  });

  return jours;
}


/* ------------------------------------------------------
   2) Charger TOUS les lots pour valoriser les stocks
------------------------------------------------------ */
async function loadLots() {
  const snap = await getDocs(collection(db, "lots"));
  const lots = [];

  snap.forEach(d => {
    const r = d.data();
    lots.push(r);
  });

  return lots;
}


/* ------------------------------------------------------
   3) Charger TOUTES les factures (pour achats période)
------------------------------------------------------ */
async function loadAchats() {
  const snap = await getDocs(collection(db, "achats"));
  const achats = [];

  snap.forEach(d => {
    const r = d.data();
    achats.push(r);
  });

  return achats;
}


/* ------------------------------------------------------
   4) Regrouper par fournisseur et par article
------------------------------------------------------ */
function groupBy(arr, key) {
  const map = {};
  arr.forEach(x => {
    const k = x[key] || "INCONNU";
    if (!map[k]) map[k] = [];
    map[k].push(x);
  });
  return map;
}


/* ------------------------------------------------------
   5) Valeur stock (début/fin) = Σ (poidsRestant × prixKg)
------------------------------------------------------ */
function computeStockValue(lots, filterFn) {
  return lots
    .filter(filterFn)
    .reduce((sum, lot) =>
      sum + (toNum(lot.poidsRestant) * toNum(lot.prixAchatKg)), 0);
}


/* ------------------------------------------------------
   6) Achats période (facture si existe, sinon BL)
------------------------------------------------------ */
function computeAchatsPeriode(achats, filterFn) {
  return achats
    .filter(filterFn)
    .reduce((sum, a) =>
      sum + toNum(a.factureHT || a.totalHT || a.montantHT || 0), 0);
}


/* ------------------------------------------------------
   7) Agrégation finale Stats
------------------------------------------------------ */
async function aggregateStats() {

  const journaux = await loadJournaux();
  const lots = await loadLots();
  const achats = await loadAchats();

  const statsF = {};   // fournisseur : { achat, vente, marge }
  const statsA = {};   // PLU : { achat, vente, marge }

  for (const j of journaux) {

    const dateStr = j.date;

    // ----------- STOCK DÉBUT -----------
    const stockDebutF = groupBy(lots, "fournisseurNom");
    const stockDebutA = groupBy(lots, "plu");

    // ----------- STOCK FIN (même lots : poidsRestant mis à jour) -----------
    const stockFinF = stockDebutF; // même structure
    const stockFinA = stockDebutA;

    // ----------- Achats période -----------
    const achatsF = groupBy(achats, "fournisseurNom");
    const achatsA = groupBy(achats, "plu");

    // ----------- Pour CHAQUE FOURNISSEUR -----------
    for (const four of Object.keys(stockDebutF)) {

      const stockDebutVal = computeStockValue(stockDebutF[four], () => true);
      const stockFinVal   = computeStockValue(stockFinF[four],   () => true);

      const achatsVal = computeAchatsPeriode(
        achatsF[four] || [],
        a => a.date === dateStr
      );

      const achatsConso = achatsVal + (stockDebutVal - stockFinVal);

      const vente = toNum(j.caReel || 0);
      const marge = vente - achatsConso;

      if (!statsF[four]) statsF[four] = { achat: 0, vente: 0, marge: 0 };
      statsF[four].achat += achatsConso;
      statsF[four].vente += vente;
      statsF[four].marge += marge;
    }

    // ----------- Pour CHAQUE ARTICLE -----------
    for (const plu of Object.keys(stockDebutA)) {

      const stockDebutVal = computeStockValue(stockDebutA[plu], () => true);
      const stockFinVal   = computeStockValue(stockFinA[plu],   () => true);

      const achatsVal = computeAchatsPeriode(
        achatsA[plu] || [],
        a => a.date === dateStr
      );

      const achatsConso = achatsVal + (stockDebutVal - stockFinVal);

      const vente = toNum(j.ventes_par_article?.[plu] || 0);
      const marge = vente - achatsConso;

      if (!statsA[plu]) statsA[plu] = { achat: 0, vente: 0, marge: 0 };
      statsA[plu].achat += achatsConso;
      statsA[plu].vente += vente;
      statsA[plu].marge += marge;
    }
  }

  return { statsF, statsA };
}


/* ------------------------------------------------------
   8) Rendu HTML
------------------------------------------------------ */
function renderTables(statsF, statsA) {

  // -------- TABLE FOURNISSEURS --------
  document.getElementById("table-fournisseurs").innerHTML =
    Object.entries(statsF).map(([four, v]) => {
      const mPct = v.vente > 0 ? (v.marge / v.vente * 100) : 0;
      return `
        <tr>
          <td>${four}</td>
          <td>${n2(v.vente)} €</td>
          <td>${n2(v.achat)} €</td>
          <td>${n2(v.marge)} €</td>
          <td>${n2(mPct)}%</td>
        </tr>
      `;
    }).join("");

  // -------- TABLE ARTICLES --------
  document.getElementById("table-articles").innerHTML =
    Object.entries(statsA).map(([plu, v]) => {
      const mPct = v.vente > 0 ? (v.marge / v.vente * 100) : 0;
      return `
        <tr>
          <td>${plu}</td>
          <td></td>
          <td>${n2(v.vente)} €</td>
          <td>${n2(v.achat)} €</td>
          <td>${n2(v.marge)} €</td>
          <td>${n2(mPct)}%</td>
        </tr>
      `;
    }).join("");
}


/* ------------------------------------------------------
   9) Search + init
------------------------------------------------------ */
async function refreshStats() {
  const { statsF, statsA } = await aggregateStats();
  renderTables(statsF, statsA);
}

elSearchF.addEventListener("input", refreshStats);
elSearchA.addEventListener("input", refreshStats);

// ------------------------------------------------------
// BOUTONS JOUR / SEMAINE / MOIS / ANNÉE
// ------------------------------------------------------
document.querySelectorAll("button[data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");

    if (p === "day") {
      document.getElementById("dateFrom").value = `${y}-${m}-${d}`;
      document.getElementById("dateTo").value = `${y}-${m}-${d}`;
    }

    if (p === "week") {
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay() + 1);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      document.getElementById("dateFrom").value = start.toISOString().slice(0, 10);
      document.getElementById("dateTo").value = end.toISOString().slice(0, 10);
    }

    if (p === "month") {
      const start = `${y}-${m}-01`;
      const end = new Date(y, today.getMonth() + 1, 0)
        .toISOString().slice(0, 10);
      document.getElementById("dateFrom").value = start;
      document.getElementById("dateTo").value = end;
    }

    if (p === "year") {
      document.getElementById("dateFrom").value = `${y}-01-01`;
      document.getElementById("dateTo").value = `${y}-12-31`;
    }

    refreshStats();
  });
});

// ------------------------------------------------------
// BOUTON CHARGER
// ------------------------------------------------------
document.getElementById("btnLoad").addEventListener("click", () => {
  refreshStats();
});


window.addEventListener("load", refreshStats);

