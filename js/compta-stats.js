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
  console.log("🚀 DÉBUT CALCUL STATS (précis par article/fournisseur)", from, to);

  // charger tout
  const [
    ca,
    ventesObj,   // { totalVentes, ventesEAN }
    mouvements,  // list des mouvements "vente-like"
    lots,
    achats,
    articlesSnap,
    stockArticlesSnap
  ] = await Promise.all([
    loadCA(from, to),
    loadVentesReelles(from, to),   // retourne { totalVentes, ventesEAN }
    loadMouvements(from, to),
    loadLots(),
    loadAchats(),
    getDocs(collection(db, "articles")),
    getDocs(collection(db, "stock_articles"))
  ]);

  const ventesEAN = ventesObj.ventesEAN || {};
  const ventesTotal = ventesObj.totalVentes || 0;

  // maps utiles
  const eanToPlu = {};
  articlesSnap.forEach(d => {
    const A = d.data();
    if (A.ean) eanToPlu[String(A.ean)] = d.id; // id = PLU
  });

  // stock_articles map : document id -> data (ids sont PLU_xxxx)
  const stockArticles = {};
  stockArticlesSnap.forEach(d => stockArticles[d.id] = d.data());

  // 1) Aggrégation mouvements -> per PLU / par movement
  const perPlu = {}; // plu -> { kgSold, cost }
  const movementsData = []; // store m + computed fields
  for (const m of mouvements) {
    const lot = lots[m.lotId];
    if (!lot) continue;
    const plu = lot.plu || lot.PLU || "UNKNOWN";
    const prixKg = Number(lot.prixAchatKg || 0);
    const poids = Number(m.poids || 0);
    const cost = prixKg * poids;

    if (!perPlu[plu]) perPlu[plu] = { kgSold: 0, cost: 0, movements: [] , designation: lot.designation || "" };
    perPlu[plu].kgSold += poids;
    perPlu[plu].cost += cost;

    const achat = achats[lot.achatId] || {};
    const fournisseur = achat.fournisseurNom || achat.fournisseur || "INCONNU";

    const md = { m, lot, plu, poids, cost, fournisseur };
    perPlu[plu].movements.push(md);
    movementsData.push(md);
  }

  // 2) Calcul CA par PLU
  const caParPlu = {}; // plu -> ca
  // si ventesEAN existantes -> utiliser (map ean->plu)
  const eanKeys = Object.keys(ventesEAN);
  if (eanKeys.length > 0) {
    for (const e of eanKeys) {
      const plu = eanToPlu[e];
      const caE = toNum(ventesEAN[e]);
      if (plu) {
        caParPlu[plu] = (caParPlu[plu] || 0) + caE;
      } else {
        console.warn("EAN sans mapping PLU :", e, "CA:", caE);
      }
    }
  }

  // pour les PLU sans CA (ou si pas de ventesEAN), fallback via pvTTCreel * kgSold
  for (const plu in perPlu) {
    if (!caParPlu[plu]) {
      // chercher pvTTCreel dans stock_articles : document id = "PLU_"+plu (ou parfois id plutot que prefix)
      const id1 = "PLU_" + String(plu);
      const sa = stockArticles[id1] || stockArticles[plu] || {};
      let pv = toNum(sa.pvTTCreel || sa.pvTTCconseille || sa.pvTTC || 0);
      // pv est TTC dans l'app (pvTTCreel), si besoin convertir HT -> ici on garde TTC pour cohérence du CA compta_journal
      if (!pv) {
        console.warn("pvTTCreel manquant pour PLU", plu, "-> CA estimée 0");
        pv = 0;
      }
      caParPlu[plu] = pv * perPlu[plu].kgSold; // CA approximé
    }
  }

  // 3) Allouer CA aux mouvements (par coût)
  const perSupplier = {}; // fournisseur -> { cost, revenue }
  for (const plu in perPlu) {
    const bucket = perPlu[plu];
    const totalCost = bucket.cost;
    const totalKg = bucket.kgSold;
    const caPlu = toNum(caParPlu[plu] || 0);

    if (totalCost > 0) {
      // allocation proportionnelle au coût
      for (const md of bucket.movements) {
        const rev = caPlu * (md.cost / totalCost);
        md.revenue = rev;
        // supplier aggregation
        if (!perSupplier[md.fournisseur]) perSupplier[md.fournisseur] = { cost:0, revenue:0 };
        perSupplier[md.fournisseur].cost += md.cost;
        perSupplier[md.fournisseur].revenue += rev;
      }
    } else if (totalKg > 0) {
      // si cost=0, répartir par kilos
      for (const md of bucket.movements) {
        const rev = caPlu * (md.poids / totalKg);
        md.revenue = rev;
        if (!perSupplier[md.fournisseur]) perSupplier[md.fournisseur] = { cost:0, revenue:0 };
        perSupplier[md.fournisseur].cost += md.cost;
        perSupplier[md.fournisseur].revenue += rev;
      }
    } else {
      // rien à allouer
      for (const md of bucket.movements) {
        md.revenue = 0;
        if (!perSupplier[md.fournisseur]) perSupplier[md.fournisseur] = { cost:0, revenue:0 };
        perSupplier[md.fournisseur].cost += md.cost;
      }
    }
  }

  // 4) Calculs finaux par PLU & fournisseur
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

  // Totaux
  const achatsConso = Object.values(perPlu).reduce((s,b)=>s + toNum(b.cost), 0);
  const margeTotale = ca - achatsConso;

  const final = {
    ca,
    ventesTotal,
    achats: achatsConso,
    marge: margeTotale,
    fournisseurs: statsFournisseurs,
    articles: statsArticles
  };

  console.log("📊 STATS PRECIS :", final);
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
