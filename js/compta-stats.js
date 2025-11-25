import { db } from "./firebase-init.js";
import {
  collection, getDocs, getDoc, doc, query, where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const el = {
  from: document.getElementById("dateFrom"),
  to: document.getElementById("dateTo"),
  btnLoad: document.getElementById("btnLoad"),
  tableF: document.getElementById("table-fournisseurs"),
  tableA: document.getElementById("table-articles"),
  resumeCA: document.getElementById("resume-ca"),
  resumeAch: document.getElementById("resume-achats"),
  resumeMarge: document.getElementById("resume-marge"),
  searchF: document.getElementById("searchF"),
  searchA: document.getElementById("searchA"),
};

let chartF = null;
let chartA = null;
let fullF = [];
let fullA = [];

const fmt = n => Number(n||0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});

// ---------- Chargement Articles (désignation) ----------
let articlesMap = {};

async function loadArticlesMap() {
  articlesMap = {};
  const snap = await getDocs(collection(db, "articles"));
  snap.forEach(d => {
    const r = d.data();
    const plu = r.plu || d.id;
    articlesMap[plu] = r.designation || "";
  });
}

// ---------- Loader principal ----------
async function loadStats() {
  const from = el.from.value;
  const to = el.to.value;

  if (!from || !to) return alert("Choisis une période complète");

  const qRef = query(
    collection(db, "compta_journal"),
    where("date", ">=", from),
    where("date", "<=", to)
  );

  const snap = await getDocs(qRef);

  let statsF = {};
  let statsA = {};

  let CA = 0;
  let ACH = 0;

  await loadArticlesMap();

  snap.forEach(docSnap => {
    const j = docSnap.data();
    CA += j.caReel || 0;

    // Fournisseurs
    if (j.achats_consommes) {
      for (const [four, montant] of Object.entries(j.achats_consommes)) {
        if (!statsF[four]) statsF[four] = { ca:0, achats:0 };
        statsF[four].achats += montant;
        statsF[four].ca += j.caReel || 0;
        ACH += montant;
      }
    }

    // Articles CA
    if (j.ventes_par_article) {
      for (const [plu, ca] of Object.entries(j.ventes_par_article)) {
        if (!statsA[plu]) statsA[plu] = { ca:0, achats:0, designation:"" };
        statsA[plu].ca += ca;
      }
    }

    // Articles achats
    if (j.consommation_par_article) {
      for (const [plu, a] of Object.entries(j.consommation_par_article)) {
        if (!statsA[plu]) statsA[plu] = { ca:0, achats:0, designation:"" };
        statsA[plu].achats += a;
      }
    }
  });

  // Marges
  for (const f of Object.values(statsF)) {
    f.marge = f.ca - f.achats;
    f.margePct = f.ca ? (f.marge / f.ca * 100) : 0;
  }

  for (const [plu, a] of Object.entries(statsA)) {
    a.designation = articlesMap[plu] || "";
    a.marge = a.ca - a.achats;
    a.margePct = a.ca ? (a.marge / a.ca * 100) : 0;
  }

  el.resumeCA.textContent = fmt(CA);
  el.resumeAch.textContent = fmt(ACH);
  el.resumeMarge.textContent = fmt(CA - ACH);

  fullF = Object.entries(statsF).map(([four, data]) => ({ four, ...data }));
  fullA = Object.entries(statsA).map(([plu, data]) => ({ plu, ...data }));

  renderTables(fullF, fullA);
  renderCharts(fullF, fullA);
}


// ---------- RENDU TABLEAUX ----------
function renderTables(four, art) {
  // Filtres live
  const sf = el.searchF.value.toLowerCase();
  const sa = el.searchA.value.toLowerCase();

  const filtF = four.filter(f => f.four.toLowerCase().includes(sf));
  const filtA = art.filter(a =>
    a.plu.toLowerCase().includes(sa) ||
    (a.designation || "").toLowerCase().includes(sa)
  );

  // Tri par marge
  filtF.sort((a,b)=>b.marge - a.marge);
  filtA.sort((a,b)=>b.marge - a.marge);

  // Fournisseurs
  el.tableF.innerHTML = "";
  filtF.forEach(f => {
    el.tableF.innerHTML += `
      <tr>
        <td>${f.four}</td>
        <td>${fmt(f.ca)}</td>
        <td>${fmt(f.achats)}</td>
        <td>${fmt(f.marge)}</td>
        <td>${f.margePct.toFixed(1)}%</td>
      </tr>
    `;
  });

  // Articles
  el.tableA.innerHTML = "";
  filtA.forEach(a => {
    el.tableA.innerHTML += `
      <tr>
        <td>${a.plu}</td>
        <td>${a.designation}</td>
        <td>${fmt(a.ca)}</td>
        <td>${fmt(a.achats)}</td>
        <td>${fmt(a.marge)}</td>
        <td>${a.margePct.toFixed(1)}%</td>
      </tr>
    `;
  });
}


// ---------- GRAPH ----------
function renderCharts(four, art) {
  const topF = [...four].sort((a,b)=>b.marge - a.marge).slice(0,10);
  const topA = [...art].sort((a,b)=>b.marge - a.marge).slice(0,10);

  // Fournisseurs
  if (chartF) chartF.destroy();
  chartF = new Chart(document.getElementById("chartFournisseurs"), {
    type:"bar",
    data:{
      labels: topF.map(x=>x.four),
      datasets:[{ label:"Marge €", data: topF.map(x=>x.marge) }]
    },
    options:{ plugins:{ legend:{display:false} } }
  });

  // Articles
  if (chartA) chartA.destroy();
  chartA = new Chart(document.getElementById("chartArticles"), {
    type:"bar",
    data:{
      labels: topA.map(x=>x.plu),
      datasets:[{ label:"Marge €", data: topA.map(x=>x.marge) }]
    },
    options:{ plugins:{ legend:{display:false} } }
  });
}


// ---------- RECHERCHE LIVE ----------
el.searchF.addEventListener("input", ()=> renderTables(fullF, fullA));
el.searchA.addEventListener("input", ()=> renderTables(fullF, fullA));


// ---------- BOUTONS JOUR / SEMAINE / MOIS / ANNÉE ----------
document.querySelectorAll("[data-period]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const p = btn.dataset.period;
    const now = new Date();

    if (p==="day") {
      el.from.value = el.to.value = now.toISOString().slice(0,10);
    }
    if (p==="week") {
      const d = new Date();
      const day = d.getDay() || 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day-1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate()+6);
      el.from.value = monday.toISOString().slice(0,10);
      el.to.value   = sunday.toISOString().slice(0,10);
    }
    if (p==="month") {
      const y = now.getFullYear();
      const m = now.getMonth();
      const first = new Date(y, m, 1);
      const last = new Date(y, m+1, 0);
      el.from.value = first.toISOString().slice(0,10);
      el.to.value   = last.toISOString().slice(0,10);
    }
    if (p==="year") {
      const y = now.getFullYear();
      el.from.value = `${y}-01-01`;
      el.to.value   = `${y}-12-31`;
    }

    loadStats();
  });
});


// ---------- Bouton charger ----------
el.btnLoad.addEventListener("click", loadStats);
