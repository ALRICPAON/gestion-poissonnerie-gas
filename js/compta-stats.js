import { db } from "./firebase-init.js";
import {
  collection, query, where, getDocs
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
};

let chartF = null;
let chartA = null;

// Format
const fmt = n => Number(n||0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});

el.btnLoad.onclick = loadStats;

async function loadStats() {
  const from = el.from.value;
  const to   = el.to.value;

  if (!from || !to) {
    alert("Choisis une période complète");
    return;
  }

  const qRef = query(
    collection(db, "compta_journal"),
    where("date", ">=", from),
    where("date", "<=", to)
  );

  const snap = await getDocs(qRef);

  const statsF = {};
  const statsA = {};
  let CA = 0;
  let achatsTot = 0;

  snap.forEach(doc => {
    const j = doc.data();
    CA += j.ca_reel || 0;

    // Fournisseurs
    if (j.achats_consommes) {
      for (const [f, montant] of Object.entries(j.achats_consommes)) {
        if (!statsF[f]) statsF[f] = { ca:0, achats:0 };
        statsF[f].achats += montant;
        statsF[f].ca += j.ca_reel || 0;
        achatsTot += montant;
      }
    }

    // Articles : CA
    if (j.ventes_par_article) {
      for (const [plu, ca] of Object.entries(j.ventes_par_article)) {
        if (!statsA[plu]) statsA[plu] = { ca:0, achats:0 };
        statsA[plu].ca += ca;
      }
    }

    // Articles : achats consommés
    if (j.consommation_par_article) {
      for (const [plu, a] of Object.entries(j.consommation_par_article)) {
        if (!statsA[plu]) statsA[plu] = { ca:0, achats:0 };
        statsA[plu].achats += a;
      }
    }
  });

  // Calcul marge fournisseurs
  for (const f of Object.values(statsF)) {
    f.marge = f.ca - f.achats;
    f.margePct = f.ca ? (f.marge / f.ca * 100) : 0;
  }

  // Calcul marge articles
  for (const a of Object.values(statsA)) {
    a.marge = a.ca - a.achats;
    a.margePct = a.ca ? (a.marge / a.ca * 100) : 0;
  }

  // Résumé
  el.resumeCA.textContent = fmt(CA);
  el.resumeAch.textContent = fmt(achatsTot);
  el.resumeMarge.textContent = fmt(CA - achatsTot);

  renderTables(statsF, statsA);
  renderCharts(statsF, statsA);
}

function renderTables(four, art) {
  // Fournisseurs
  el.tableF.innerHTML = "";
  const arrF = Object.entries(four)
    .map(([k,v]) => ({ four:k, ...v }))
    .sort((a,b)=>b.marge - a.marge);

  arrF.forEach(f => {
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
  const arrA = Object.entries(art)
    .map(([plu,v]) => ({ plu, ...v }))
    .sort((a,b)=>b.marge - a.marge);

  arrA.forEach(a => {
    el.tableA.innerHTML += `
      <tr>
        <td>${a.plu}</td>
        <td>${a.designation || ""}</td>
        <td>${fmt(a.ca)}</td>
        <td>${fmt(a.achats)}</td>
        <td>${fmt(a.marge)}</td>
        <td>${a.margePct.toFixed(1)}%</td>
      </tr>
    `;
  });
}

function renderCharts(four, art) {
  const topF = Object.entries(four)
    .map(([k,v]) => ({ four:k, ...v }))
    .sort((a,b)=>b.marge - a.marge)
    .slice(0,10);

  const topA = Object.entries(art)
    .map(([k,v]) => ({ plu:k, ...v }))
    .sort((a,b)=>b.marge - a.marge)
    .slice(0,10);

  // Fournisseurs
  if (chartF) chartF.destroy();
  chartF = new Chart(document.getElementById("chartFournisseurs"), {
    type:"bar",
    data:{
      labels: topF.map(x=>x.four),
      datasets:[{
        label:"Marge €",
        data: topF.map(x=>x.marge)
      }]
    },
    options:{ plugins:{ legend:{display:false} } }
  });

  // Articles
  if (chartA) chartA.destroy();
  chartA = new Chart(document.getElementById("chartArticles"), {
    type:"bar",
    data:{
      labels: topA.map(x=>x.plu),
      datasets:[{
        label:"Marge €",
        data: topA.map(x=>x.marge)
      }]
    },
    options:{ plugins:{ legend:{display:false} } }
  });
}
