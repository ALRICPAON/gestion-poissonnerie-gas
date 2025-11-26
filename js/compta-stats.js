// compta-stats.js
import { db } from "./firebase-init.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const elStats = document.getElementById("statsContainer");
const elMode = document.getElementById("modeSelect");
const elSearchF = document.getElementById("searchF");
const elSearchA = document.getElementById("searchA");


function toNum(v) {
  const x = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(x) ? x : 0;
}

function n2(v) {
  return Number(v || 0).toFixed(2);
}

function ymd(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

function matchSearch(key, q) {
  return !q || key.toLowerCase().includes(q.toLowerCase());
}

async function loadJournaux() {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];
  snap.forEach(doc => {
    const r = doc.data();
    if (!r.validated) return;
    jours.push(r);
  });
  return jours;
}

function aggregateStats(journaux, search = "") {
  const fournisseurs = {};
  const articles = {};

  for (const j of journaux) {
    for (const [four, achat] of Object.entries(j.achats_consommes || {})) {
      if (!matchSearch(four, search)) continue;
      const vente = j.caReel * (achat / j.achatsConsoHT);
      const marge = vente - achat;

      if (!fournisseurs[four]) fournisseurs[four] = { achat: 0, vente: 0, marge: 0 };
      fournisseurs[four].achat += achat;
      fournisseurs[four].vente += vente;
      fournisseurs[four].marge += marge;
    }
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

function createTable(title, data) {
  const rows = Object.entries(data).map(([k, v]) => {
    const mPct = v.vente > 0 ? (v.marge / v.vente * 100) : 0;
    return `<tr>
      <td>${k}</td>
      <td>${n2(v.vente)} €</td>
      <td>${n2(v.achat)} €</td>
      <td>${n2(v.marge)} €</td>
      <td>${n2(mPct)}%</td>
    </tr>`;
  }).join("");

  return `<h3>${title}</h3>
  <table class="stats-table">
    <thead>
      <tr><th>Nom</th><th>CA</th><th>Achats</th><th>Marge</th><th>M%</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function refreshStats() {
  const data = await loadJournaux();

  const { fournisseurs } = aggregateStats(data, elSearchF.value.trim());
  const { articles } = aggregateStats(data, elSearchA.value.trim());

  document.getElementById("table-fournisseurs").innerHTML = Object.entries(fournisseurs).map(([four, val]) => {
    const pct = val.vente > 0 ? (val.marge / val.vente * 100) : 0;
    return `<tr>
      <td>${four}</td>
      <td>${n2(val.vente)} €</td>
      <td>${n2(val.achat)} €</td>
      <td>${n2(val.marge)} €</td>
      <td>${n2(pct)}%</td>
    </tr>`;
  }).join("");

  document.getElementById("table-articles").innerHTML = Object.entries(articles).map(([plu, val]) => {
    const pct = val.vente > 0 ? (val.marge / val.vente * 100) : 0;
    const designation = ""; // à enrichir si tu as un mapping PLU -> nom
    return `<tr>
      <td>${plu}</td>
      <td>${designation}</td>
      <td>${n2(val.vente)} €</td>
      <td>${n2(val.achat)} €</td>
      <td>${n2(val.marge)} €</td>
      <td>${n2(pct)}%</td>
    </tr>`;
  }).join("");
}
elSearchF.addEventListener("input", refreshStats);
elSearchA.addEventListener("input", refreshStats);
window.addEventListener("load", refreshStats);



