// js/compta-stats.js
// Statistiques — CA → HT, marges, top fournisseurs / articles / poids
// Reprend calculs + UI (boutons période, recherches, export CSV, charts)

/* global Chart */

import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, where, doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ---------------- UTILS ---------------- */
const fmt = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 }) + " €";
const toNum = v => { const n = Number(v||0); return isFinite(n)? n : 0; };
const pad2 = n => String(n).padStart(2,'0');
const todayISO = () => {
  const d = new Date(); return d.toISOString().slice(0,10);
};

/* TVA utilisée pour convertir TTC -> HT (5.5%) */
const TVA_RATE = 0.055;

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
  // On essaie de filtrer par createdAt mais si createdAt est un timestamp Firestore on lira tous et filtrera côté JS
  const col = collection(db, "stock_movements");
  // read all (ok pour volumes raisonnables). Si gros volume, il faudra paginer.
  const snap = await getDocs(col);
  const list = [];
  const start = new Date(from + "T00:00:00").getTime();
  const end = new Date(to + "T23:59:59").getTime();
  snap.forEach(d => {
    const m = d.data();
    // ne conserver que sorties utiles
    const sens = (m.sens || "").toString().toLowerCase();
    let type = (m.type || "").toString().toLowerCase();
    if (!type && m.origin) type = (m.origin || "").toString().toLowerCase();
    if (sens !== "sortie") return;
    if (type === "transformation" || type === "correction") return;
    const poids = Number(m.poids ?? m.quantity ?? 0);
    if (!poids) return;
    // determine createdAt/date comparable
    let dd = null;
    if (m.date) {
      // date may be "YYYY-MM-DD"
      dd = new Date(m.date + "T00:00:00").getTime();
    } else if (m.createdAt && m.createdAt.toDate) {
      dd = m.createdAt.toDate().getTime();
    } else if (m.createdAt && typeof m.createdAt === 'string') {
      dd = new Date(m.createdAt).getTime();
    } else {
      dd = Date.now();
    }
    if (dd >= start && dd <= end) list.push(m);
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
  // charge tout en parallèle
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

  // map EAN->PLU
  const eanToPlu = {};
  articlesSnap.forEach(d => { const A = d.data(); if (A && A.ean) eanToPlu[String(A.ean)] = d.id; });

  // stock articles map
  const stockArticles = {};
  stockArticlesSnap.forEach(d => stockArticles[d.id] = d.data());

  // per PLU aggregates from movements
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

  // build caParPlu from ventesEAN via mapping or fallback using pvTTCreel
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

  for (const plu in perPlu) {
    if (!caParPlu[plu]) {
      const id1 = "PLU_"+String(plu);
      const sa = stockArticles[id1] || stockArticles[plu] || {};
      let pv = toNum(sa.pvTTCreel || sa.pvTTCconseille || sa.pvTTC || 0);
      if (!pv) { console.warn("pvTTCreel manquant pour PLU", plu); pv = 0; }
      caParPlu[plu] = pv * perPlu[plu].kgSold;
    }
  }

  // Convertir CA (qui provient de TTC) en HT pour cohérence avec cost HT
  for (const plu in caParPlu) {
    caParPlu[plu] = toNum(caParPlu[plu]) / (1 + TVA_RATE);
  }

  // allocate CA to movements and aggregate per supplier
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

  // build final objects
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
    tr.innerHTML = `<td>${row.plu}</td>
      <td>${escapeHtml(row.designation || "")}</td>
      <td class="right">${fmt(row.ca)}</td>
      <td class="right">${fmt(row.cost)}</td>
      <td class="right">${fmt(row.marge)}</td>
      <td class="right">${Number(row.margePct||0).toFixed(1)}%</td>`;
    tbody.appendChild(tr);
  });
}

function renderArticlesWeightTable(list) {
  const tbody = document.getElementById('table-articles-weight');
  clearElement(tbody);
  list.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.plu}</td>
      <td>${escapeHtml(row.designation || "")}</td>
      <td class="right">${(row.kgSold||0).toFixed(3)}</td>
      <td class="right">${fmt(row.ca)}</td>
      <td class="right">${fmt(row.cost)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---- simple escape html ---- */
function escapeHtml(s){
  if(!s) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

/* ---------------- Charts ---------------- */
function buildBarChart(canvasId, labels, data, label) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (canvasId === 'chartFournisseurs' && chartF) chartF.destroy();
  if (canvasId === 'chartArticles' && chartA) chartA.destroy();
  if (canvasId === 'chartArticlesWeight' && chartAW) chartAW.destroy();

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: label || '',
        data,
        backgroundColor: 'rgba(54,162,235,0.6)'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: { x: { ticks: { autoSkip: false } } }
    }
  });

  if (canvasId === 'chartFournisseurs') chartF = chart;
  if (canvasId === 'chartArticles') chartA = chart;
  if (canvasId === 'chartArticlesWeight') chartAW = chart;
}

/* ---------------- Export CSV ---------------- */
function arrayToCSV(rows) {
  // rows: [ [h1,h2,...], [v1,v2,...], ... ]
  return rows.map(r => r.map(c => {
    if (c == null) return '';
    const s = String(c).replace(/"/g,'""');
    return `"${s}"`;
  }).join(",")).join("\n");
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- UI wiring ---------------- */
function setPeriodRange(period) {
  const today = new Date();
  let from, to;
  if (period === 'day') {
    from = to = today;
  } else if (period === 'week') {
    const day = today.getDay(); // 0..6
    const diff = (day + 6) % 7; // monday as start
    from = new Date(today.getTime() - diff*24*3600*1000);
    to = new Date(from.getTime() + 6*24*3600*1000);
  } else if (period === 'month') {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to = new Date(today.getFullYear(), today.getMonth()+1, 0);
  } else if (period === 'year') {
    from = new Date(today.getFullYear(), 0, 1);
    to = new Date(today.getFullYear(), 11, 31);
  } else {
    from = to = today;
  }
  document.getElementById('dateFrom').value = from.toISOString().slice(0,10);
  document.getElementById('dateTo').value = to.toISOString().slice(0,10);
}

function attachUIHandlers() {
  // period buttons
  document.querySelectorAll('[data-period]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const p = btn.getAttribute('data-period');
      setPeriodRange(p);
    });
  });

  // load
  document.getElementById('btnLoad').addEventListener('click', async ()=>{
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    const topN = Number(document.getElementById('topN').value) || 10;
    const status = document.getElementById('status');
    status.textContent = "⏳ Calcul en cours...";
    try {
      const data = await buildAdvancedStats(from, to, { topN });
      renderSummary(data.summary);
      // tables
      renderFournisseursTable(data.fournisseurs);
      renderArticlesTable(data.top.topByCA); // By CA
      renderArticlesWeightTable(data.top.topByKg);
      // charts
      buildBarChart('chartFournisseurs', data.fournisseurs.map(x=>x.fournisseur), data.fournisseurs.map(x=>x.ca), 'CA fournisseur (HT)');
      buildBarChart('chartArticles', data.top.topByCA.map(x=>x.plu+" "+x.designation), data.top.topByCA.map(x=>x.ca), 'Top CA (HT)');
      buildBarChart('chartArticlesWeight', data.top.topByKg.map(x=>x.plu+" "+x.designation), data.top.topByKg.map(x=>x.kgSold), 'Top Kg vendus');
      status.textContent = `✅ OK — période ${from} → ${to}`;
    } catch(err) {
      console.error(err);
      status.textContent = "Erreur: " + (err && err.message ? err.message : String(err));
    }
  });

  // searches + exports
  document.getElementById('searchF').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    const rows = Array.from(document.querySelectorAll('#table-fournisseurs tr'));
    rows.forEach(tr=>{
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  document.getElementById('searchA').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    const rows = Array.from(document.querySelectorAll('#table-articles tr'));
    rows.forEach(tr=>{
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  document.getElementById('searchAWeight').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    const rows = Array.from(document.querySelectorAll('#table-articles-weight tr'));
    rows.forEach(tr=>{
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  document.getElementById('btnExportFournisseurs').addEventListener('click', ()=>{
    const rows = Array.from(document.querySelectorAll('#table-fournisseurs tr')).map(tr=>{
      return Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim());
    });
    const csv = arrayToCSV([['Fournisseur','CA (HT)','Achats','Marge','Marge %'], ...rows]);
    downloadCSV('fournisseurs.csv', csv);
  });

  document.getElementById('btnExportArticles').addEventListener('click', ()=>{
    const rows = Array.from(document.querySelectorAll('#table-articles tr')).map(tr=>{
      return Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim());
    });
    const csv = arrayToCSV([['PLU','Désignation','CA (HT)','Achats','Marge','Marge %'], ...rows]);
    downloadCSV('articles.csv', csv);
  });

  document.getElementById('btnExportArticlesWeight').addEventListener('click', ()=>{
    const rows = Array.from(document.querySelectorAll('#table-articles-weight tr')).map(tr=>{
      return Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim());
    });
    const csv = arrayToCSV([['PLU','Désignation','Kg vendus','CA (HT)','Achats'], ...rows]);
    downloadCSV('articles_weight.csv', csv);
  });

  document.getElementById('btnExportCSV').addEventListener('click', async ()=>{
    // export top CA from current selection
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    const topN = Number(document.getElementById('topN').value) || 10;
    const stats = await buildAdvancedStats(from, to, { topN });
    const rows = stats.top.topByCA.map(r => [r.plu, r.designation, fmt(r.ca), fmt(r.cost), fmt(r.marge), Number(r.margePct||0).toFixed(1) + '%']);
    const csv = arrayToCSV([['PLU','Désignation','CA (HT)','Achats','Marge','Marge %'], ...rows]);
    downloadCSV('top_ca.csv', csv);
  });
}

/* ---------------- init ---------------- */
function init() {
  // default period: month
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
  document.getElementById('dateFrom').value = first.toISOString().slice(0,10);
  document.getElementById('dateTo').value = last.toISOString().slice(0,10);
  attachUIHandlers();
}

window.addEventListener('load', () => {
  try { init(); } catch(e) { console.error("Init stats err", e); }
});

/* ---------------- Exports ---------------- */
export { calculStats, buildAdvancedStats };
export default { calculStats, buildAdvancedStats };
