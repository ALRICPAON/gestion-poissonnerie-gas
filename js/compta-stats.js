// compta-stats.js
import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ---------- Utils ---------- */
const toNum = (v) => {
  if (v == null) return 0;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
};
const n2 = (v) => Number(v || 0).toFixed(2);

function todayYMD() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** date string "YYYY-MM-DD" comparables en lexicographique */
function inDateRange(dStr, fromStr, toStr) {
  if (!dStr) return false;
  if (fromStr && dStr < fromStr) return false;
  if (toStr && dStr > toStr) return false;
  return true;
}

/* ---------- DOM ---------- */
const btnPeriod = document.querySelectorAll("[data-period]");
const inputFrom = document.getElementById("dateFrom");
const inputTo = document.getElementById("dateTo");
const btnLoad = document.getElementById("btnLoad");

const elResumeCA = document.getElementById("resume-ca");
const elResumeAchats = document.getElementById("resume-achats");
const elResumeMarge = document.getElementById("resume-marge");

const elSearchF = document.getElementById("searchF");
const elSearchA = document.getElementById("searchA");
const tbodyF = document.getElementById("table-fournisseurs");
const tbodyA = document.getElementById("table-articles");

const canvasF = document.getElementById("chartFournisseurs");
const canvasA = document.getElementById("chartArticles");

let chartF = null;
let chartA = null;

// caches globaux pour re-filtrer sans recharger Firestore
let statsFournisseurs = {}; // { code: { code, nom, achat, vente, marge } }
let statsArticles = {};     // { plu: { plu, designation, achat, vente, marge } }
let resumeGlobal = { ca: 0, achats: 0, marge: 0 };

/* ---------- Raccourcis périodes ---------- */
function setPeriod(type) {
  const today = new Date();
  let from = new Date(today);
  let to = new Date(today);

  if (type === "day") {
    // aujourd'hui
  } else if (type === "week") {
    const day = (today.getDay() + 6) % 7; // lundi=0
    from.setDate(today.getDate() - day);
    to = new Date(from);
    to.setDate(from.getDate() + 6);
  } else if (type === "month") {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (type === "year") {
    from = new Date(today.getFullYear(), 0, 1);
    to = new Date(today.getFullYear(), 11, 31);
  }

  const fY = from.getFullYear();
  const fM = String(from.getMonth() + 1).padStart(2, "0");
  const fD = String(from.getDate()).padStart(2, "0");
  const tY = to.getFullYear();
  const tM = String(to.getMonth() + 1).padStart(2, "0");
  const tD = String(to.getDate()).padStart(2, "0");

  inputFrom.value = `${fY}-${fM}-${fD}`;
  inputTo.value = `${tY}-${tM}-${tD}`;
}

/* ---------- Chargement Firestore ---------- */

/** charge tous les journaux validés dans la plage */
async function loadJournaux(fromStr, toStr) {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];
  snap.forEach((d) => {
    const r = d.data();
    if (!r.validated) return;
    const dateStr = r.date || d.id;
    if (!inDateRange(dateStr, fromStr, toStr)) return;
    jours.push({ id: d.id, ...r });
  });
  return jours;
}

/** map codeFournisseur -> nom (via collection achats) */
async function loadFournisseursNames() {
  const snap = await getDocs(collection(db, "achats"));
  const map = {};
  snap.forEach((d) => {
    const r = d.data();
    const code = r.fournisseurCode;
    if (!code) return;
    if (map[code]) return;
    map[code] = r.fournisseurNom || r.designationFournisseur || code;
  });
  return map;
}

/** map PLU -> designation (via collection articles, si elle existe) */
async function loadArticlesNames() {
  try {
    const snap = await getDocs(collection(db, "articles"));
    const map = {};
    snap.forEach((d) => {
      const r = d.data();
      const plu = r.plu || d.id;
      if (!plu) return;
      map[plu] = r.designation || r.nom || "";
    });
    return map;
  } catch (e) {
    // si la collection n'existe pas, on renvoie juste un objet vide
    return {};
  }
}

/* ---------- Agrégation ---------- */
async function computeStats(fromStr, toStr) {
  statsFournisseurs = {};
  statsArticles = {};
  resumeGlobal = { ca: 0, achats: 0, marge: 0 };

  const [jours, fourNames, artNames] = await Promise.all([
    loadJournaux(fromStr, toStr),
    loadFournisseursNames(),
    loadArticlesNames()
  ]);

  for (const j of jours) {
    const caJour = toNum(j.caReel || 0);
    const achatsConsoJour = toNum(j.achatsConsoHT || 0);

    resumeGlobal.ca += caJour;
    resumeGlobal.achats += achatsConsoJour;

    // --------- Fournisseurs : j.achats_consommes => on répartit le CA proportionnellement ---------
    const mapFour = j.achats_consommes || {};
    const totalAchatsMap = Object.values(mapFour).reduce(
      (s, v) => s + toNum(v),
      0
    );

    for (const [code, valAchat] of Object.entries(mapFour)) {
      const achat = toNum(valAchat);
      if (!statsFournisseurs[code]) {
        statsFournisseurs[code] = {
          code,
          nom: fourNames[code] || code,
          achat: 0,
          vente: 0,
          marge: 0
        };
      }
      const rec = statsFournisseurs[code];
      rec.achat += achat;

      // CA du fournisseur proportionnel à sa part d'achat consommé
      let caPart = 0;
      if (totalAchatsMap > 0 && caJour > 0) {
        caPart = caJour * (achat / totalAchatsMap);
      }
      rec.vente += caPart;
      rec.marge += caPart - achat;
    }

    // --------- Articles : consommation_par_article + ventes_par_article ---------
    const mapConso = j.consommation_par_article || {};
    const mapVentes = j.ventes_par_article || {};

    const plus = new Set([
      ...Object.keys(mapConso),
      ...Object.keys(mapVentes)
    ]);

    plus.forEach((plu) => {
      const achat = toNum(mapConso[plu] || 0);
      const vente = toNum(mapVentes[plu] || 0);
      const marge = vente - achat;

      if (!statsArticles[plu]) {
        statsArticles[plu] = {
          plu,
          designation: artNames[plu] || "",
          achat: 0,
          vente: 0,
          marge: 0
        };
      }
      const rec = statsArticles[plu];
      rec.achat += achat;
      rec.vente += vente;
      rec.marge += marge;
    });
  }

  resumeGlobal.marge = resumeGlobal.ca - resumeGlobal.achats;
}

/* ---------- Rendering ---------- */

function renderResume() {
  elResumeCA.textContent = `${n2(resumeGlobal.ca)} €`;
  elResumeAchats.textContent = `${n2(resumeGlobal.achats)} €`;
  elResumeMarge.textContent = `${n2(resumeGlobal.marge)} €`;
}

function renderTablesAndCharts() {
  const qF = (elSearchF.value || "").toLowerCase();
  const qA = (elSearchA.value || "").toLowerCase();

  // ------- Fournisseurs -------
  let arrF = Object.values(statsFournisseurs);
  arrF.sort((a, b) => b.marge - a.marge);

  if (qF) {
    arrF = arrF.filter((f) =>
      (f.nom || f.code).toLowerCase().includes(qF)
    );
  }

  tbodyF.innerHTML = arrF
    .map((f) => {
      const mPct = f.vente > 0 ? (f.marge / f.vente) * 100 : 0;
      return `<tr>
        <td>${f.nom || f.code}</td>
        <td>${n2(f.vente)} €</td>
        <td>${n2(f.achat)} €</td>
        <td>${n2(f.marge)} €</td>
        <td>${n2(mPct)} %</td>
      </tr>`;
    })
    .join("");

  // chart top 10
  const topF = arrF.slice(0, 10);
  if (chartF) chartF.destroy();
  chartF = new Chart(canvasF, {
    type: "bar",
    data: {
      labels: topF.map((f) => f.nom || f.code),
      datasets: [
        { label: "CA", data: topF.map((f) => f.vente) },
        { label: "Achats", data: topF.map((f) => f.achat) },
        { label: "Marge", data: topF.map((f) => f.marge) }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // ------- Articles -------
  let arrA = Object.values(statsArticles);
  arrA.sort((a, b) => b.marge - a.marge);

  if (qA) {
    arrA = arrA.filter((a) => {
      const label = `${a.plu} ${a.designation || ""}`.toLowerCase();
      return label.includes(qA);
    });
  }

  tbodyA.innerHTML = arrA
    .map((a) => {
      const mPct = a.vente > 0 ? (a.marge / a.vente) * 100 : 0;
      return `<tr>
        <td>${a.plu}</td>
        <td>${a.designation || ""}</td>
        <td>${n2(a.vente)} €</td>
        <td>${n2(a.achat)} €</td>
        <td>${n2(a.marge)} €</td>
        <td>${n2(mPct)} %</td>
      </tr>`;
    })
    .join("");

  // chart top 10
  const topA = arrA.slice(0, 10);
  if (chartA) chartA.destroy();
  chartA = new Chart(canvasA, {
    type: "bar",
    data: {
      labels: topA.map((a) => a.plu),
      datasets: [
        { label: "CA", data: topA.map((a) => a.vente) },
        { label: "Achats", data: topA.map((a) => a.achat) },
        { label: "Marge", data: topA.map((a) => a.marge) }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

/* ---------- Orchestration ---------- */
async function loadAndRender() {
  const fromStr = inputFrom.value || todayYMD();
  const toStr = inputTo.value || fromStr;

  await computeStats(fromStr, toStr);
  renderResume();
  renderTablesAndCharts();
}

/* ---------- Events ---------- */

// boutons période
btnPeriod.forEach((btn) => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period;
    setPeriod(p);
    loadAndRender();
  });
});

// bouton "Charger"
btnLoad.addEventListener("click", () => {
  loadAndRender();
});

// recherche
elSearchF.addEventListener("input", renderTablesAndCharts);
elSearchA.addEventListener("input", renderTablesAndCharts);

/* ---------- Init ---------- */
(function init() {
  const today = todayYMD();
  inputFrom.value = today;
  inputTo.value = today;
  loadAndRender();
})();
