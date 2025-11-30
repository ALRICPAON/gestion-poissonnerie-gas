// js/compta-stats.js (VERSION UI + POIDS)
// Calculs + UI : CA, marges, top articles, et top articles par poids (kg).

import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, where, doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ---------------- UTILS ---------------- */
const fmt = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 }) + " €";
const toNum = v => { const n = Number(v||0); return isFinite(n)? n : 0; };
const d2 = d => (d instanceof Date ? d.toISOString().slice(0,10) : String(d||""));

/* ---------------- DATA LOADERS ---------------- */
async function loadCA(from, to) {
  try {
    const col = collection(db, "compta_journal");
    const q = query(col, where("date", ">=", from), where("date", "<=", to));
    const snap = await getDocs(q);
    let total = 0;
    snap.forEach(d => total += toNum(d.data().caReel || 0));
    return total;
  } catch(e) {
    console.warn("loadCA error", e);
    return 0;
  }
}

async function loadVentesReelles(from, to) {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T23:59:59");
  const oneDay = 24*3600*1000;
  let totalVentes = 0;
  const ventesEAN = {};
  for(let t = start.getTime(); t <= end.getTime(); t += oneDay){
    const dateStr = new Date(t).toISOString().slice(0,10);
    try {
      const snap = await getDoc(doc(db, "ventes_reelles", dateStr));
      if(!snap.exists()) continue;
      const o = snap.data();
      if(o.caHT) totalVentes += toNum(o.caHT);
      else if(o.ventes && typeof o.ventes === "object") {
        for(const e in o.ventes){ ventesEAN[e] = (ventesEAN[e]||0) + toNum(o.ventes[e]); totalVentes += toNum(o.ventes[e]); }
      } else if(o.ventesEAN && typeof o.ventesEAN === "object"){
        for(const e in o.ventesEAN){ ventesEAN[e] = (ventesEAN[e]||0) + toNum(o.ventesEAN[e]); totalVentes += toNum(o.ventesEAN[e]); }
      } else if(o.totalCA) totalVentes += toNum(o.totalCA);
      else if(o.caTTC) totalVentes += toNum(o.caTTC);
    } catch(e){ console.warn("loadVentesReelles err", e); }
  }
  return { totalVentes, ventesEAN };
}

async function loadMouvements(from, to) {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T23:59:59");
  const col = collection(db, "stock_movements");
  let q;
  try { q = query(col, where("createdAt", ">=", start), where("createdAt", "<=", end)); }
  catch(e) { q = collection(db, "stock_movements"); }
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => {
    const m = d.data();
    const sens = (m.sens || "").toString().toLowerCase();
    let type = (m.type || "").toString().toLowerCase();
    if (!type && m.origin) type = (m.origin || "").toString().toLowerCase();
    if (sens !== "sortie") return;
    if (type === "transformation" || type === "correction") return;
    if (!m.poids && !m.quantity) return;
    const poids = Number(m.poids ?? m.quantity ?? 0);
    if (poids === 0) return;
    list.push(m);
  });
  return list;
}

async function loadLots() {
  const snap = await getDocs(collection(db, "lots"));
  const out = {};
  snap.forEach(d => out[d.id] = d.data());
  return out;
}

async function loadAchats() {
  const snap = await getDocs(collection(db, "achats"));
  const out = {};
  snap.forEach(d => out[d.id] = d.data());
  return out;
}

/* ---------------- CORE STATS ---------------- */
async function calculStats(from, to) {
  const [ca, ventesObj, mouvements, lots, achats, articlesSnap, stockArticlesSnap] = await Promise.all([
    loadCA(from, to),
    loadVentesReelles(from, to),
    loadMouvements(from, to),
    loadLots(),
    loadAchats(),
    getDocs(collection(db, "articles")),
    getDocs(collection(db, "stock_articles"))
  ]);

  const ventesEAN = ventesObj.ventesEAN || {};
  const ventesTotal = ventesObj.totalVentes || 0;

  // ean -> plu
  const eanToPlu = {};
  articlesSnap.forEach(d => { const A = d.data(); if (A && A.ean) eanToPlu[String(A.ean)] = d.id; });

  // stock_articles map
  const stockArticles = {};
  stockArticlesSnap.forEach(d => stockArticles[d.id] = d.data());

  // per PLU (kg, cost, movements)
  const perPlu = {};
  for (const m of mouvements) {
    const lot = lots[m.lotId];
    if (!lot) continue;
    const plu = lot.plu || lot.PLU || "UNKNOWN";
    const prixKg = toNum(lot.prixAchatKg || 0);
    const poids = toNum(m.poids ?? m.quantity ?? 0);
    const cost = prixKg * poids;

    if (!perPlu[plu]) perPlu[plu] = { kgSold:0, cost:0, movements:[], designation: lot.designation || "" };
    perPlu[plu].kgSold += poids;
    perPlu[plu].cost += cost;

    const achat = achats[lot.achatId] || {};
    const fournisseur = achat.fournisseurNom || achat.fournisseur || "INCONNU";
    perPlu[plu].movements.push({ m, lot, plu, poids, cost, fournisseur });
  }

  // CA per PLU
  const caParPlu = {};
  const eanKeys = Object.keys(ventesEAN);
  if (eanKeys.length) {
    for (const e of eanKeys) {
      const plu = eanToPlu[e];
      const caE = toNum(ventesEAN[e]);
      if (plu) caParPlu[plu] = (caParPlu[plu]||0) + caE;
      else console.warn("EAN sans mapping PLU:", e, caE);
    }
  }

  // fallback pvTTCreel * kgSold
  for (const plu in perPlu) {
    if (!caParPlu[plu]) {
      const id1 = "PLU_"+String(plu);
      const sa = stockArticles[id1] || stockArticles[plu] || {};
      let pv = toNum(sa.pvTTCreel || sa.pvTTCconseille || sa.pvTTC || 0);
      if (!pv) { console.warn("pvTTCreel manquant pour PLU", plu); pv = 0; }
      caParPlu[plu] = pv * perPlu[plu].kgSold;
    }
  }

  // allocate CA to movements, aggregate per supplier
  const perSupplier = {};
  for (const plu in perPlu) {
    const bucket = perPlu[plu];
    const totalCost = bucket.cost;
    const totalKg = bucket.kgSold;
    const caPlu = toNum(caParPlu[plu] || 0);

    if (totalCost > 0) {
      for (const md of bucket.movements) {
        const rev = caPlu * (md.cost / totalCost);
        md.revenue = rev;
        if (!perSupplier[md.fournisseur]) perSupplier[md.fournisseur] = { cost:0, revenue:0 };
        perSupplier[md.fournisseur].cost += md.cost;
        perSupplier[md.fournisseur].revenue += rev;
      }
    } else if (totalKg > 0) {
      for (const md of bucket.movements) {
        const rev = caPlu * (md.poids / totalKg);
        md.revenue = rev;
        if (!perSupplier[md.fournisseur]) perSupplier[md.fournisseur] = { cost:0, revenue:0 };
        perSupplier[md.fournisseur].cost += md.cost;
        perSupplier[md.fournisseur].revenue += rev;
      }
    } else {
      for (const md of bucket.movements) {
        md.revenue = 0;
        if (!perSupplier[md.fournisseur]) perSupplier[md.fournisseur] = { cost:0, revenue:0 };
        perSupplier[md.fournisseur].cost += md.cost;
      }
    }
  }

  // final objects
  const statsArticles = {};
  for (const plu in perPlu) {
    const bucket = perPlu[plu];
    const caP = toNum(caParPlu[plu] || 0);
    const costP = toNum(bucket.cost || 0);
    const marge = caP - costP;
    const margePct = caP > 0 ? (marge / caP * 100) : 0;
    statsArticles[plu] = {
      designation: bucket.designation || "",
      kgSold: bucket.kgSold,
      cost: costP,
      ca: caP,
      marge,
      margePct
    };
  }

  const statsFournisseurs = {};
  for (const f in perSupplier) {
    const s = perSupplier[f];
    const m = toNum(s.revenue) - toNum(s.cost);
    statsFournisseurs[f] = {
      achats: toNum(s.cost),
      ca: toNum(s.revenue),
      marge: m,
      margePct: toNum(s.revenue) > 0 ? (m / toNum(s.revenue) * 100) : 0
    };
  }

  const achatsConso = Object.values(perPlu).reduce((s,b)=>s + toNum(b.cost), 0);
  const margeTotale = ca - achatsConso;

  return {
    ca,
    ventesTotal,
    achats: achatsConso,
    marge: margeTotale,
    fournisseurs: statsFournisseurs,
    articles: statsArticles
  };
}

/* ---------------- Advanced wrapper + UI ---------------- */
async function buildAdvancedStats(from, to, opts = {}) {
  const topN = opts.topN || 10;
  const base = await calculStats(from, to);

  const articlesArr = Object.keys(base.articles || {}).map(plu => {
    const a = base.articles[plu];
    return { plu, designation: a.designation, kgSold: a.kgSold, cost: a.cost, ca: a.ca, marge: a.marge, margePct: a.margePct };
  });

  const topByCA = articlesArr.slice().sort((a,b)=>b.ca - a.ca).slice(0, topN);
  const topByMarge = articlesArr.slice().sort((a,b)=>b.marge - a.marge).slice(0, topN);
  const topByMargePct = articlesArr.slice().sort((a,b)=>b.margePct - a.margePct).slice(0, topN);
  const topByKg = articlesArr.slice().sort((a,b)=>b.kgSold - a.kgSold).slice(0, topN);

  const fournisseursArr = Object.keys(base.fournisseurs || {}).map(f => {
    const v = base.fournisseurs[f];
    return { fournisseur: f, achats: v.achats, ca: v.ca, marge: v.marge, margePct: v.margePct };
  }).sort((a,b)=>b.ca - a.ca).slice(0, topN);

  return {
    period: { from, to },
    summary: { ca: toNum(base.ca), achats: toNum(base.achats), marge: toNum(base.marge) },
    top: { topByCA, topByMarge, topByMargePct, topByKg },
    articles: articlesArr,
    fournisseurs: fournisseursArr
  };
}

/* ---------------- UI helpers ---------------- */
let chartF = null, chartA = null, chartAW = null;

function clearElement(el) { while(el.firstChild) el.removeChild(el.firstChild); }

function renderSummary(summary) {
  document.getElementById('resume-ca').textContent = fmt(summary.ca);
  document.getElementById('resume-achats').textContent = fmt(summary.achats);
  document.getElementById('resume-marge').textContent = fmt(summary.marge);
}

function renderFournisseursTable(list) {
  const tbody = document.getElementById('table-fournisseurs');
  clearElement(tbody);
  list.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.fournisseur)}</td>
      <td>${fmt(row.ca)}</td><td>${fmt(row.achats)}</td><td>${fmt(row.marge)}</td><td>${Number(row.margePct||0).toFixed(1)}%</td>`;
    tbody.appendChild(tr);
  });
}

function renderArticlesTable(list) {
  const tbody = document.getElementById('table-articles');
  clearElement(tbody);
  list.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.plu)}</td>
      <td>${escapeHtml(row.designation||"")}</td>
      <td>${fmt(row.ca)}</td><td>${fmt(row.cost)}</td><td>${fmt(row.marge)}</td><td>${Number(row.margePct||0).toFixed(1)}%</td>`;
    tbody.appendChild(tr);
  });
}

function renderArticlesWeightTable(list) {
  const tbody = document.getElementById('table-articles-weight');
  clearElement(tbody);
  list.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.plu)}</td>
      <td>${escapeHtml(row.designation||"")}</td>
      <td>${Number(row.kgSold||0).toFixed(2)} kg</td>
      <td>${fmt(row.ca)}</td><td>${fmt(row.cost)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderCharts(topByCA, fournisseurs) {
  // Fournisseurs chart: use fournisseurs (marge)
  try {
    const ctxF = document.getElementById('chartFournisseurs').getContext('2d');
    if (chartF) chartF.destroy();
    chartF = new Chart(ctxF, {
      type: 'bar',
      data: {
        labels: fournisseurs.map(r => r.fournisseur),
        datasets: [{ label: 'Marge €', data: fournisseurs.map(r => r.marge), backgroundColor: '#3b82f6' }]
      },
      options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{beginAtZero:true} } }
    });
  } catch(e){ console.warn(e); }

  // Articles chart: CA
  try {
    const ctxA = document.getElementById('chartArticles').getContext('2d');
    if (chartA) chartA.destroy();
    chartA = new Chart(ctxA, {
      type: 'bar',
      data: {
        labels: topByCA.map(r => String(r.plu) + " " + (r.designation||"")),
        datasets: [{ label: 'CA', data: topByCA.map(r => r.ca), backgroundColor: '#10b981' }]
      },
      options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{beginAtZero:true} } }
    });
  } catch(e){ console.warn(e); }
}

function renderArticlesWeightChart(topByKg) {
  try {
    const ctx = document.getElementById('chartArticlesWeight').getContext('2d');
    if (chartAW) chartAW.destroy();
    chartAW = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: topByKg.map(r => String(r.plu) + (r.designation ? " " + r.designation : "")),
        datasets: [{ label: 'Kg vendus', data: topByKg.map(r => Number(r.kgSold||0)), backgroundColor: '#f59e0b' }]
      },
      options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{beginAtZero:true} } }
    });
  } catch(e){ console.warn(e); }
}

function escapeHtml(s){ if(s==null) return ""; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

/* ---------------- EXPORT util ---------------- */
function exportToCSV(rows, filename="export.csv") {
  if (!rows || !rows.length) return alert("Rien à exporter");
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  rows.forEach(r => lines.push(cols.map(c => `"${String(r[c]===undefined ? "" : r[c]).replace(/"/g,'""')}"`).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

/* ---------------- UI Wiring ---------------- */
function setDefaultDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
  document.getElementById('dateFrom').value = d2(start);
  document.getElementById('dateTo').value = d2(end);
}

function setPeriod(mode) {
  const now = new Date();
  let start, end;
  if (mode === "day") { start = new Date(now); start.setHours(0,0,0,0); end = new Date(start); }
  else if (mode === "week") {
    const day = (now.getDay()+6)%7;
    start = new Date(now); start.setDate(now.getDate()-day); start.setHours(0,0,0,0);
    end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
  } else if (mode === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth()+1, 0);
  } else if (mode === "year") {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31);
  }
  document.getElementById('dateFrom').value = d2(start);
  document.getElementById('dateTo').value = d2(end);
}

async function loadAndRender() {
  const status = document.getElementById('status');
  try {
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    const topN = Number(document.getElementById('topN').value) || 10;
    status.textContent = `Chargement ${from} → ${to} ...`;
    const report = await buildAdvancedStats(from, to, { topN });
    renderSummary(report.summary);
    renderFournisseursTable(report.fournisseurs);
    renderArticlesTable(report.top.topByCA);
    renderArticlesWeightTable(report.top.topByKg);
    renderCharts(report.top.topByCA, report.fournisseurs);
    renderArticlesWeightChart(report.top.topByKg);
    window.__LAST_STATS_REPORT = report;
    status.textContent = `OK — données chargées (${from} → ${to})`;
  } catch(e) {
    console.error(e);
    status.textContent = `Erreur : ${e && e.message ? e.message : String(e)}`;
  }
}

/* ---------------- Attach events ---------------- */
function attachEvents() {
  document.querySelectorAll('[data-period]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      document.querySelectorAll('[data-period]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      setPeriod(btn.dataset.period);
    });
  });

  document.getElementById('btnLoad').addEventListener('click', loadAndRender);

  document.getElementById('btnExportCSV').addEventListener('click', ()=>{
    const r = window.__LAST_STATS_REPORT;
    if (!r) return alert("Charge d'abord les stats.");
    exportToCSV(r.top.topByCA, `topByCA_${r.period.from}_${r.period.to}.csv`);
  });

  document.getElementById('searchF').addEventListener('input', (e)=>{
    const q = (e.target.value || "").toLowerCase().trim();
    const data = (window.__LAST_STATS_REPORT && window.__LAST_STATS_REPORT.fournisseurs) || [];
    const filtered = data.filter(x => x.fournisseur.toLowerCase().includes(q));
    renderFournisseursTable(filtered);
  });

  document.getElementById('searchA').addEventListener('input', (e)=>{
    const q = (e.target.value || "").toLowerCase().trim();
    const data = (window.__LAST_STATS_REPORT && window.__LAST_STATS_REPORT.articles) || [];
    const filtered = data.filter(x => (String(x.plu) + " " + (x.designation||"")).toLowerCase().includes(q));
    const sorted = filtered.sort((a,b)=>b.ca - a.ca).slice(0, Number(document.getElementById('topN').value || 10));
    renderArticlesTable(sorted);
    renderCharts(sorted, (window.__LAST_STATS_REPORT && window.__LAST_STATS_REPORT.fournisseurs) || []);
  });

  // search & export for weight view
  document.getElementById('searchAWeight').addEventListener('input', (e)=>{
    const q = (e.target.value || "").toLowerCase().trim();
    const data = (window.__LAST_STATS_REPORT && window.__LAST_STATS_REPORT.articles) || [];
    const filtered = data.filter(x => (String(x.plu) + " " + (x.designation||"")).toLowerCase().includes(q));
    const sorted = filtered.sort((a,b)=>b.kgSold - a.kgSold).slice(0, Number(document.getElementById('topN').value || 10));
    renderArticlesWeightTable(sorted);
    renderArticlesWeightChart(sorted);
  });

  document.getElementById('btnExportFournisseurs').addEventListener('click', ()=>{
    const r = window.__LAST_STATS_REPORT;
    if (!r) return alert("Charge d'abord les stats.");
    exportToCSV(r.fournisseurs, `fournisseurs_${r.period.from}_${r.period.to}.csv`);
  });

  document.getElementById('btnExportArticles').addEventListener('click', ()=>{
    const r = window.__LAST_STATS_REPORT;
    if (!r) return alert("Charge d'abord les stats.");
    exportToCSV(r.top.topByCA, `articles_CA_${r.period.from}_${r.period.to}.csv`);
  });

  document.getElementById('btnExportArticlesWeight').addEventListener('click', ()=>{
    const r = window.__LAST_STATS_REPORT;
    if (!r) return alert("Charge d'abord les stats.");
    exportToCSV(r.top.topByKg, `articles_kg_${r.period.from}_${r.period.to}.csv`);
  });
}

/* ---------------- Init ---------------- */
(function init(){
  setDefaultDates();
  attachEvents();
  try { window.buildAdvancedStats = buildAdvancedStats; window.calculStats = calculStats; window.exportToCSV = exportToCSV; } catch(e){}
})();

export { buildAdvancedStats, calculStats, exportToCSV };
