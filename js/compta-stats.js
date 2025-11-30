// js/compta-stats.js (VERSION COMPLÈTE)
// Stats précises : CA réel par article (ventes_reelles/compta_journal) + coût réel depuis lots consommés
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
   1) LOAD CA RÉEL (compta_journal)
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
   2) LOAD ventes_reelles (détail par jour)
   - retourne { totalVentes, ventesEAN }
-------------------------------------------------------------------*/
async function loadVentesReelles(from, to) {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T23:59:59");
  const oneDay = 24*3600*1000;

  let totalVentes = 0;
  const ventesEAN = {}; // ean -> ca (TTC ou valeur utilisée)

  for(let t = start.getTime(); t <= end.getTime(); t += oneDay){
    const dateStr = new Date(t).toISOString().slice(0,10);
    try {
      const snap = await getDoc(doc(db, "ventes_reelles", dateStr));
      if(!snap.exists()) continue;
      const o = snap.data();
      if(o.caHT) {
        totalVentes += toNum(o.caHT);
      } else if(o.ventes && typeof o.ventes === "object") {
        for(const e in o.ventes){ ventesEAN[e] = (ventesEAN[e]||0) + toNum(o.ventes[e]); totalVentes += toNum(o.ventes[e]); }
      } else if(o.ventesEAN && typeof o.ventesEAN === "object"){
        for(const e in o.ventesEAN){ ventesEAN[e] = (ventesEAN[e]||0) + toNum(o.ventesEAN[e]); totalVentes += toNum(o.ventesEAN[e]); }
      } else if(o.totalCA) {
        totalVentes += toNum(o.totalCA);
      } else if(o.caTTC) {
        totalVentes += toNum(o.caTTC);
      }
    } catch(e){
      console.warn("Erreur loadVentesReelles pour", dateStr, e);
    }
  }
  console.log("📈 ventes_reelles total:", totalVentes, "EAN entries:", Object.keys(ventesEAN).length);
  return { totalVentes, ventesEAN };
}

/* ------------------------------------------------------------------
   3) LOAD MOUVEMENTS (stock_movements) : sorties utiles
   - Exclut transformations & corrections (internes)
   - Inclut inventory si tu génères les ventes via inventaire
-------------------------------------------------------------------*/
async function loadMouvements(from, to) {
  console.log("📥 Load MOVEMENTS from stock_movements (filtered for sales-like)...");

  const start = new Date(from + "T00:00:00");
  const end   = new Date(to   + "T23:59:59");

  const col = collection(db, "stock_movements");
  let q;
  try {
    q = query(col, where("createdAt", ">=", start), where("createdAt", "<=", end));
  } catch(e) {
    // si createdAt non indexable, on récupère tout (fallback)
    q = collection(db, "stock_movements");
  }

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
    // NOTE: on inclut "inventory" car tu as indiqué que les ventes peuvent être générées via inventaire.
    if (!m.poids || Number(m.poids) <= 0) return;
    list.push(m);
    const key = `${sens}|${type||"undefined"}`;
    stats[key] = (stats[key]||0) + 1;
  });

  console.log("📦 mouvements retenus (sortie, exclu transformation/correction) :", stats, "→ total:", list.length);
  return list;
}

/* ------------------------------------------------------------------
   4) LOAD LOTS & ACHATS
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
   5) CALCUL STATISTIQUES (PRÉCIS)
   - coût = somme poids * prixAchatKg par lot consommé
   - CA par PLU : prioritaire ventes_reelles (EAN -> PLU), sinon pvTTCreel * kgSold
   - allocation CA aux mouvements selon coût, puis agrégation fournisseur
-------------------------------------------------------------------*/
async function calculStats(from, to) {
  console.log("🚀 DÉBUT CALCUL STATS (précis par article/fournisseur)", from, to);

  // charger data nécessaires (articles & stock_articles inclus)
  const [
    ca,
    ventesObj,
    mouvements,
    lots,
    achats,
    articlesSnap,
    stockArticlesSnap
  ] = await Promise.all([
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

  // map EAN -> PLU
  const eanToPlu = {};
  articlesSnap.forEach(d => {
    const A = d.data();
    if (A.ean) eanToPlu[String(A.ean)] = d.id; // d.id est généralement le PLU
  });

  // stock_articles map
  const stockArticles = {};
  stockArticlesSnap.forEach(d => stockArticles[d.id] = d.data());

  // 1) Agrégation mouvements -> per PLU
  const perPlu = {}; // plu -> { kgSold, cost, movements:[], designation }
  for (const m of mouvements) {
    const lot = lots[m.lotId];
    if (!lot) continue;
    const plu = lot.plu || lot.PLU || "UNKNOWN";
    const prixKg = Number(lot.prixAchatKg || 0);
    const poids = Number(m.poids || 0);
    const cost = prixKg * poids;

    if (!perPlu[plu]) perPlu[plu] = { kgSold: 0, cost: 0, movements: [], designation: lot.designation || "" };
    perPlu[plu].kgSold += poids;
    perPlu[plu].cost += cost;

    const achat = achats[lot.achatId] || {};
    const fournisseur = achat.fournisseurNom || achat.fournisseur || "INCONNU";

    const md = { m, lot, plu, poids, cost, fournisseur };
    perPlu[plu].movements.push(md);
  }

  // 2) CA par PLU
  const caParPlu = {}; // plu -> ca
  const eanKeys = Object.keys(ventesEAN);
  if (eanKeys.length > 0) {
    for (const e of eanKeys) {
      const plu = eanToPlu[e];
      const caE = toNum(ventesEAN[e]);
      if (plu) {
        caParPlu[plu] = (caParPlu[plu] || 0) + caE;
      } else {
        // EAN sans mapping PLU: on logue (manuel possible)
        console.warn("EAN sans mapping PLU :", e, "CA:", caE);
      }
    }
  }

  // fallback : pvTTCreel * kgSold
  for (const plu in perPlu) {
    if (!caParPlu[plu]) {
      const id1 = "PLU_" + String(plu);
      const sa = stockArticles[id1] || stockArticles[plu] || {};
      let pv = toNum(sa.pvTTCreel || sa.pvTTCconseille || sa.pvTTC || 0);
      if (!pv) {
        // try recommended pv from perPlu or set 0
        console.warn("pvTTCreel manquant pour PLU", plu, "-> CA estimée 0 (si tu veux autre fallback, dis-moi)");
        pv = 0;
      }
      caParPlu[plu] = pv * perPlu[plu].kgSold;
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

  // 4) Calculs finaux
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

  const final = {
    ca,
    ventesTotal,
    achats: achatsConso,
    marge: margeTotale,
    fournisseurs: statsFournisseurs,
    articles: statsArticles
  };

  console.log("✅ calculStats terminé :", { ca: final.ca, achats: final.achats, marge: final.marge });
  return final;
}

/* ---------------- Advanced stats wrapper ---------------- */

/**
 * buildAdvancedStats(from, to, opts)
 * from,to : 'YYYY-MM-DD' strings
 * opts: { topN: number }
 */
async function buildAdvancedStats(from, to, opts = {}) {
  const topN = opts.topN || 10;

  // 1) calcul de base (tu as déjà calculStats)
  const base = await calculStats(from, to); // retourne { ca, ventesTotal, achats, marge, fournisseurs, articles, ... }
  // base.articles[plu] = { designation, kgSold, cost, ca, marge, margePct }
  // base.fournisseurs[f] = { achats, ca, marge, margePct }

  // 2) top lists
  const articlesArr = Object.keys(base.articles || {}).map(plu => {
    const a = base.articles[plu];
    return {
      plu,
      designation: a.designation || "",
      kgSold: toNum(a.kgSold || 0),
      cost: toNum(a.cost || 0),
      ca: toNum(a.ca || 0),
      marge: toNum(a.marge || 0),
      margePct: toNum(a.margePct || 0)
    };
  });

  const topByCA = articlesArr.slice().sort((a,b)=>b.ca - a.ca).slice(0, topN);
  const topByMarge = articlesArr.slice().sort((a,b)=>b.marge - a.marge).slice(0, topN);
  const topByMargePct = articlesArr.slice().sort((a,b)=>b.margePct - a.margePct).slice(0, topN);
  const topByKg = articlesArr.slice().sort((a,b)=>b.kgSold - a.kgSold).slice(0, topN);

  // 3) fournisseurs
  const fournisseursArr = Object.keys(base.fournisseurs || {}).map(f => {
    const v = base.fournisseurs[f];
    return {
      fournisseur: f,
      achats: toNum(v.achats || 0),
      ca: toNum(v.ca || 0),
      marge: toNum(v.marge || 0),
      margePct: toNum(v.margePct || 0)
    };
  }).sort((a,b)=>b.ca - a.ca);

  // 4) rotation / stock moyen
  async function loadJournalInventaires(){
    const s = [];
    const snap = await getDocs(collection(db, "journal_inventaires"));
    snap.forEach(d => {
      const r = d.data();
      const dateStr = r.date || d.id;
      const dt = new Date(dateStr);
      if(isFinite(dt)) s.push({ date: dt, valeur: toNum(r.valeurStockHT||0) });
    });
    s.sort((a,b)=>a.date-b.date);
    return s;
  }

  function pickStocksFromJournal(invs, startDate, endDate) {
    let stockDebut = 0, stockFin = 0;
    const beforeStart = invs.filter(x=>x.date < startDate);
    if (beforeStart.length) stockDebut = beforeStart[beforeStart.length-1].valeur;
    const beforeEnd = invs.filter(x=>x.date <= endDate);
    if (beforeEnd.length) stockFin = beforeEnd[beforeEnd.length-1].valeur;
    return { stockDebut, stockFin };
  }

  const invs = await loadJournalInventaires();
  const startDate = new Date(from + "T00:00:00");
  const endDate = new Date(to + "T23:59:59");
  let { stockDebut, stockFin } = pickStocksFromJournal(invs, startDate, endDate);

  // fallback -> compute from lots if journal missing or zero
  if ((toNum(stockDebut) === 0 && toNum(stockFin) === 0)) {
    const lotsSnap = await getDocs(collection(db, "lots"));
    let stockVal = 0;
    lotsSnap.forEach(d => {
      const l = d.data();
      const kg = toNum(l.poidsRestant || l.poids || 0);
      const prix = toNum(l.prixAchatKg || 0);
      stockVal += kg * prix;
    });
    stockFin = stockVal;
    // estimate stockDebut by using relation: stockFin = stockDebut + achatsPeriodeHT - achatsConso
    // we don't have achatsPeriodeHT here exactly; use base.achats if available
    const achatsPeriode = toNum(base.achats || 0);
    const achatsConso = toNum(base.achats || 0);
    stockDebut = stockFin - achatsPeriode + achatsConso;
  }

  const stockMoyen = (toNum(stockDebut) + toNum(stockFin)) / 2;
  const cogs = toNum(base.achats || 0);

  const nbDays = Math.max(1, Math.round((endDate - startDate) / (24*3600*1000)) + 1);
  const rotation = stockMoyen > 0 ? (cogs / stockMoyen) : 0;
  const daysToTurn = (cogs > 0 && rotation>0) ? (nbDays / rotation) : 0;

  // 5) pertes / écarts : somme inventory_adjustment / correction dans period
  let losses = 0;
  try {
    const movSnap = await getDocs(query(collection(db, "stock_movements"), where("createdAt", ">=", startDate), where("createdAt", "<=", endDate)));
    movSnap.forEach(d=>{
      const m = d.data();
      const t = (m.type || "").toString().toLowerCase();
      if (t.includes("inventory") || t.includes("adjust") || t.includes("correction")) {
        const qty = Math.abs(toNum(m.poids ?? m.quantity ?? 0));
        let cost = 0;
        if (m.costValue) cost = toNum(m.costValue);
        else if (m.montantHT) cost = toNum(m.montantHT);
        else cost = toNum(m.prixAchatKg || m.pma || 0) * qty;
        losses += cost;
      }
    });
  } catch(e) {
    console.warn("Erreur calcul pertes:", e);
  }

  // 6) joursSeries depuis compta_journal
  const joursSeries = [];
  try {
    const journalSnap = await getDocs(collection(db, "compta_journal"));
    journalSnap.forEach(d=>{
      const r = d.data();
      const dt = new Date(r.date || d.id);
      if (dt >= startDate && dt <= endDate) {
        joursSeries.push({ date: r.date || d.id, ca: toNum(r.caReel||0), achatsConso: toNum(r.achatsConsoHT||0), marge: toNum(r.marge||0) });
      }
    });
  } catch(e){ /* ignore */ }

  const report = {
    period: { from, to, nbDays },
    summary: {
      ca: toNum(base.ca || 0),
      ventesTotal: toNum(base.ventesTotal || 0),
      achatsConso: cogs,
      marge: toNum(base.marge || 0),
      margePct: (toNum(base.ca)||0) > 0 ? (toNum(base.marge) / toNum(base.ca) * 100) : 0
    },
    stock: { stockDebut: toNum(stockDebut), stockFin: toNum(stockFin), stockMoyen: toNum(stockMoyen), rotation, daysToTurn },
    losses: toNum(losses),
    top: { topByCA, topByMarge, topByMargePct, topByKg },
    articles: articlesArr,
    fournisseurs: fournisseursArr,
    joursSeries
  };

  return report;
}

/* ---------------- Export util ---------------- */
function exportToCSV(rows, filename = "export.csv") {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  rows.forEach(r => {
    lines.push(cols.map(c => `"${String(r[c]===undefined ? "" : r[c]).replace(/"/g,'""')}"`).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
