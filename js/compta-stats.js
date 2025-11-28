// js/compta-stats.js (adapté : achats=lots, ventes réelles + compta_journal, transformation exclue)
import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, where, orderBy, doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ------------------------------------------------------------------
   UTILS
-------------------------------------------------------------------*/
const fmt = n => Number(n || 0).toFixed(2) + " €";
const d2 = d => d.toISOString().split("T")[0];
function toNum(v){ const n = Number(v||0); return isFinite(n)? n: 0; }

/* ------------------------------------------------------------------
   LOAD CA RÉEL (compta_journal)
-------------------------------------------------------------------*/
async function loadCA(from, to) {
  const col = collection(db, "compta_journal");
  const qy = query(col,
    where("date", ">=", from),
    where("date", "<=", to)
  );
  const snap = await getDocs(qy);
  let totalCA = 0;
  snap.forEach(d => { totalCA += Number(d.data().caReel || 0); });
  console.log("💰 Total CA (compta_journal) =", totalCA);
  return totalCA;
}

/* ------------------------------------------------------------------
   LOAD ventes_reelles (optionnel, détail par jour)
   --> On tente de récupérer CA détaillé par EAN/PLU si présent
-------------------------------------------------------------------*/
async function loadVentesReelles(from, to) {
  // parcourt chaque jour entre from/to et lit ventes_reelles/{YYYY-MM-DD}
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T23:59:59");
  const oneDay = 24*3600*1000;

  let totalVentes = 0;
  const ventesEAN = {}; // ean -> caTTC or caHT depending on doc shape
  for(let t = start.getTime(); t <= end.getTime(); t += oneDay){
    const dateStr = new Date(t).toISOString().slice(0,10);
    const snap = await getDoc(doc(db, "ventes_reelles", dateStr));
    if(!snap.exists()) continue;
    const o = snap.data();
    // Prefer field caHT if present, else try a mapping "ventes" or "ventesEAN"
    if(o.caHT) {
      totalVentes += toNum(o.caHT);
    } else if(o.ventes && typeof o.ventes === "object") {
      // ventes: { ean: ca }
      for(const e in o.ventes){ ventesEAN[e] = (ventesEAN[e]||0) + toNum(o.ventes[e]); totalVentes += toNum(o.ventes[e]); }
    } else if(o.ventesEAN && typeof o.ventesEAN === "object"){
      for(const e in o.ventesEAN){ ventesEAN[e] = (ventesEAN[e]||0) + toNum(o.ventesEAN[e]); totalVentes += toNum(o.ventesEAN[e]); }
    } else if(o.totalCA) {
      totalVentes += toNum(o.totalCA);
    } else {
      // fallback: maybe field caTTC
      if(o.caTTC) totalVentes += toNum(o.caTTC);
    }
  }
  console.log("📈 ventes_reelles total:", totalVentes, "EAN entries:", Object.keys(ventesEAN).length);
  return { totalVentes, ventesEAN };
}

/* ------------------------------------------------------------------
   LOAD MOUVEMENTS (stock_movements)
   - on considère consommations = sorties EXCLUANT transformations & corrections
   - on INCLUT inventory si les ventes sont générées via inventaire (cas de ton projet)
-------------------------------------------------------------------*/
async function loadMouvements(from, to) {
  console.log("📥 Load MOVEMENTS from stock_movements (filtered for sales)...");

  const start = new Date(from + "T00:00:00");
  const end   = new Date(to   + "T23:59:59");

  // requête par createdAt
  const col = collection(db, "stock_movements");
  const q = query(col,
    where("createdAt", ">=", start),
    where("createdAt", "<=", end)
  );

  const snap = await getDocs(q);
  const list = [];
  const stats = {};
  snap.forEach(d => {
    const m = d.data();
    const sens = (m.sens || "").toString().toLowerCase();
    const type = (m.type || "").toString().toLowerCase();
    if (sens !== "sortie") return;
    // Exclure transformations (internes) et corrections
    if (type === "transformation" || type === "correction") return;
    // Exclure inventory only if you really want to ignore inventory corrections.
    // But since in your projet les ventes sont *générées via inventaire*, on accepte inventory as sale-like.
    // If you want to exclude inventory, comment the next two lines.
    // if (type === "inventory") return;
    if (!m.poids || Number(m.poids) <= 0) return;
    list.push(m);
    const key = `${sens}|${type||"undefined"}`;
    stats[key] = (stats[key]||0) + 1;
  });

  console.log("📦 mouvements retenus (sortie, exclu transformation/correction) :", stats, "→ total:", list.length);
  return list;
}

/* ------------------------------------------------------------------
   LOAD LOTS & ACHATS helpers
-------------------------------------------------------------------*/
async function loadLots() {
  const col = collection(db, "lots");
  const snap = await getDocs(col);
  const lots = {};
  snap.forEach(d => lots[d.id] = d.data());
  console.log("📥 LOTS chargés :", Object.keys(lots).length);
  return lots;
}

async function loadAchats() {
  const col = collection(db, "achats");
  const snap = await getDocs(col);
  const achats = {};
  snap.forEach(d => achats[d.id] = d.data());
  console.log("📥 ACHATS chargés :", Object.keys(achats).length);
  return achats;
}

/* ------------------------------------------------------------------
   CALCUL STATISTIQUES (fournisseurs + articles)
-------------------------------------------------------------------*/
async function calculStats(from, to) {
  console.log("🚀 DÉBUT CALCUL STATS", from, to);

  const [ca, ventesObj, mouvements, lots, achats] = await Promise.all([
    loadCA(from, to),
    loadVentesReelles(from, to),
    loadMouvements(from, to),
    loadLots(),
    loadAchats()
  ]);

  const ventesTotal = ventesObj.totalVentes || 0;
  const ventesEAN = ventesObj.ventesEAN || {};

  // achats consommés calculés depuis mouvements retenus (sorties)
  let achatsConso = 0;
  const statsFournisseurs = {}; // fournisseurNom -> { achats, ca, marge, margePct }
  const statsArticles = {};     // plu -> { designation, achats, ca, marge, margePct }

  for (const m of mouvements) {
    const lot = lots[m.lotId];
    if (!lot) continue;
    // ne pas compter si mouvement de transformation (déjà exclu), mais garder traçabilité
    const prixKg = Number(lot.prixAchatKg || 0);
    const po = Number(m.poids || 0);
    const achatHT = prixKg * po;
    achatsConso += achatHT;

    const achat = achats[lot.achatId] || {};
    const fournisseur = achat.fournisseurNom || achat.fournisseur || "INCONNU";
    const plu = lot.plu || lot.PLU || "UNKNOWN";
    const designation = lot.designation || "";

    if (!statsFournisseurs[fournisseur]) statsFournisseurs[fournisseur] = { achats:0, ca:0, marge:0, margePct:0 };
    statsFournisseurs[fournisseur].achats += achatHT;

    if (!statsArticles[plu]) statsArticles[plu] = { designation, achats:0, ca:0, marge:0, margePct:0 };
    statsArticles[plu].achats += achatHT;
  }

  // Allocation du CA :
  // si on a un détail ventes par EAN, on essaye de mapper EAN -> PLU via /articles (coûteux mais précis).
  // Sinon on répartit proportionnellement aux achats consommés.
  if (achatsConso > 0) {
    // si detail ventes par EAN existe, essayer d'utiliser
    const eans = Object.keys(ventesEAN);
    if (eans.length > 0) {
      // build article map ean -> plu (lecture articles collection)
      const artSnap = await getDocs(collection(db, "articles"));
      const eanToPlu = {};
      artSnap.forEach(d => {
        const A = d.data();
        if (A.ean) eanToPlu[String(A.ean)] = d.id; // d.id is usually PLU
      });

      // distribute ventesEAN to PLU when possible
      let allocatedCA = 0;
      for (const e of eans) {
        const caE = toNum(ventesEAN[e]);
        const mappedPlu = eanToPlu[e];
        if (mappedPlu) {
          if (!statsArticles[mappedPlu]) statsArticles[mappedPlu] = { designation:"", achats:0, ca:0, marge:0, margePct:0 };
          statsArticles[mappedPlu].ca = (statsArticles[mappedPlu].ca || 0) + caE;
        }
        allocatedCA += caE;
      }

      // Si ventesEAN total < CA compta_journal, complétion proportionnelle
      const remainingCA = ca - allocatedCA;
      if (remainingCA > 0) {
        // répartir proportionnellement aux achats consommés
        for (const p in statsArticles) {
          const ach = statsArticles[p].achats || 0;
          const add = remainingCA * (ach / achatsConso);
          statsArticles[p].ca = (statsArticles[p].ca || 0) + add;
        }
      }
    } else {
      // pas de détail ventes, répartition proportionnelle
      for (const f in statsFournisseurs) {
        const ach = statsFournisseurs[f].achats;
        const caAlloc = ca * (ach / achatsConso);
        statsFournisseurs[f].ca = caAlloc;
        statsFournisseurs[f].marge = caAlloc - ach;
        statsFournisseurs[f].margePct = caAlloc > 0 ? (statsFournisseurs[f].marge / caAlloc * 100) : 0;
      }
      for (const p in statsArticles) {
        const ach = statsArticles[p].achats;
        const caAlloc = ca * (ach / achatsConso);
        statsArticles[p].ca = caAlloc;
        statsArticles[p].marge = caAlloc - ach;
        statsArticles[p].margePct = caAlloc > 0 ? (statsArticles[p].marge / caAlloc * 100) : 0;
      }
    }
  } else {
    // aucun achat consommé -> tout à zéro (ou marge négative si achats existent mais pas consommés)
    for (const f in statsFournisseurs) {
      statsFournisseurs[f].ca = 0;
      statsFournisseurs[f].marge = -statsFournisseurs[f].achats;
      statsFournisseurs[f].margePct = 0;
    }
    for (const p in statsArticles) {
      statsArticles[p].ca = 0;
      statsArticles[p].marge = -statsArticles[p].achats;
      statsArticles[p].margePct = 0;
    }
  }

  // Calcul marge globale
  const margeTotale = ca - achatsConso;
  const final = {
    ca,
    ventesTotal,
    achats: achatsConso,
    marge: margeTotale,
    fournisseurs: statsFournisseurs,
    articles: statsArticles
  };
  console.log("📊 STATS FINALES :", final);
  return final;
}

/* ------------------------------------------------------------------
   RENDU HTML (mêmes fonctions que précédemment)
-------------------------------------------------------------------*/
function renderStats(stats) {
  document.querySelector("#resume-ca").textContent = fmt(stats.ca);
  document.querySelector("#resume-achats").textContent = fmt(stats.achats);
  document.querySelector("#resume-marge").textContent = fmt(stats.marge);

  // FOURNISSEURS
  const tf = document.querySelector("#table-fournisseurs");
  tf.innerHTML = "";
  Object.entries(stats.fournisseurs).forEach(([name, s]) => {
    const pct = s.ca > 0 ? (s.marge / s.ca * 100).toFixed(1) : "0.0";
    tf.innerHTML += `
      <tr>
        <td>${name}</td>
        <td>${fmt(s.ca)}</td>
        <td>${fmt(s.achats)}</td>
        <td>${fmt(s.marge)}</td>
        <td>${pct}%</td>
      </tr>`;
  });

  // ARTICLES
  const ta = document.querySelector("#table-articles");
  ta.innerHTML = "";
  Object.entries(stats.articles).forEach(([plu, a]) => {
    const pct = a.ca > 0 ? (a.marge / a.ca * 100).toFixed(1) : "0.0";
    ta.innerHTML += `
      <tr>
        <td>${plu}</td>
        <td>${a.designation || ""}</td>
        <td>${fmt(a.ca)}</td>
        <td>${fmt(a.achats)}</td>
        <td>${fmt(a.marge)}</td>
        <td>${pct}%</td>
      </tr>`;
  });
}

/* Charts (Chart.js) */
function renderChartFournisseurs(fournisseurs) {
  const ctx = document.getElementById('chartFournisseurs').getContext('2d');
  const labels = Object.keys(fournisseurs);
  const data = Object.values(fournisseurs).map(f => Number(f.marge || 0));
  if (window._chartF) window._chartF.destroy();
  window._chartF = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: "Marge (€)", data }] } });
}
function renderChartArticles(articles) {
  const ctx = document.getElementById('chartArticles').getContext('2d');
  const labels = Object.keys(articles);
  const data = Object.values(articles).map(a => Number(a.marge || 0));
  if (window._chartA) window._chartA.destroy();
  window._chartA = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: "Marge (€)", data }] } });
}

/* ------------------------------------------------------------------
   BOUTONS / CHARGEMENT
-------------------------------------------------------------------*/
document.querySelector("#btnLoad").addEventListener("click", async () => {
  const from = document.querySelector("#dateFrom").value;
  const to = document.querySelector("#dateTo").value;
  if (!from || !to) { alert("Choisis une période valide (Du / Au)."); return; }
  document.querySelector("#resume-ca").textContent = "Calcul en cours…";
  const stats = await calculStats(from, to);
  renderStats(stats);
  renderChartFournisseurs(stats.fournisseurs);
  renderChartArticles(stats.articles);
});

/* Raccourcis */
document.querySelectorAll("[data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period; const now = new Date();
    let from, to;
    if (p === "day") { from = to = d2(now); }
    else if (p === "week") { const d = new Date(); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); from = d2(d); to = d2(new Date()); }
    else if (p === "month") { from = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-01"; to = d2(now); }
    else if (p === "year") { from = now.getFullYear() + "-01-01"; to = d2(now); }
    document.querySelector("#dateFrom").value = from;
    document.querySelector("#dateTo").value = to;
    document.querySelector("#btnLoad").click();
  });
});
