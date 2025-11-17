/**************************************************
 *  STOCK.JS – Module Stock Poissonnerie
 *  - Charge tous les lots
 *  - Regroupe TRAD / FE / LS
 *  - Calcule PMA, PV réels, marge, valeur stock
 *  - Met à jour le header + les tableaux
 **************************************************/

import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * RÉGLAGES MARGES (global)
 **************************************************/
const marginRef = doc(db, "stock_settings", "global");

/**************************************************
 * CHARGER LES MARGES
 **************************************************/
async function loadMargins() {
  const snap = await getDoc(marginRef);
  if (snap.exists()) {
    const d = snap.data();
    document.getElementById("margeTrad").value = d.trad || 35;
    document.getElementById("margeFE").value = d.fe || 35;
    document.getElementById("margeLS").value = d.ls || 35;
  } else {
    document.getElementById("margeTrad").value = 35;
    document.getElementById("margeFE").value   = 35;
    document.getElementById("margeLS").value   = 35;
  }
}

/**************************************************
 * SAUVEGARDE DES MARGES
 **************************************************/
async function saveMargins() {
  await setDoc(marginRef, {
    trad: Number(document.getElementById("margeTrad").value),
    fe:   Number(document.getElementById("margeFE").value),
    ls:   Number(document.getElementById("margeLS").value),
  }, { merge: true });

  alert("Marges enregistrées !");
}

/**************************************************
 * DÉTERMINE LE TYPE DE RAYON (TRAD / FE / LS)
 **************************************************/
function detectCategory(article) {
  const desi = article.designation?.toUpperCase() || "";
  const plu  = article.plu || "";
  const gencode = article.gencode || "";

  if (gencode && gencode.length === 13) return "ls";
  if (desi.startsWith("FE.")) return "fe";
  return "trad";
}

/**************************************************
 * CALCUL PMA (Prix Moyen d’Achat HT)
 **************************************************/
function computePMA(lots) {
  let totalPoids = 0;
  let totalCost  = 0;

  for (const lot of lots) {
    const p = Number(lot.poidsRestant || 0);
    const pa = Number(lot.prixAchatKg || 0);

    totalPoids += p;
    totalCost  += p * pa;
  }

  if (totalPoids === 0) return { pma: 0, poids: 0 };
  return { pma: totalCost / totalPoids, poids: totalPoids };
}

/**************************************************
 * CHARGE PRIX RÉELS STOCKÉS DANS Firestore
 **************************************************/
async function loadRealPrice(key) {
  const r = await getDoc(doc(db, "stock_settings/articles", key));
  if (!r.exists()) return null;
  return r.data();
}

/**************************************************
 * CLÉ UNIQUE POUR STOCK_SETTINGS/ARTICLES
 **************************************************/
function makeKey(article) {
  // LS → gencod
  if (article.gencode && article.gencode.length === 13) {
    return "LS-" + article.gencode;
  }

  // TRAD & FE → PLU
  if (article.plu && article.plu !== "") {
    return "PLU-" + article.plu;
  }

  // Cas sans PLU ni gencode → identifiant technique
  return "AUTO-" + (article.achatId || "A") + "-" + (article.ligneId || "L");
}



/**************************************************
 * CALCUL DE LA MARQUE RÉELLE (LIVE)
 **************************************************/
function computeRealMargin(pvHT, pma) {
  if (!pvHT || pvHT <= 0) return 0;
  return (pvHT - pma) / pvHT;
}

/**************************************************
 * MET À JOUR LA BANDE HEADER
 **************************************************/
function updateHeader(res) {
  const fmt = v => Number(v).toLocaleString("fr-FR", { style:"currency", currency:"EUR" });
  const pct = v => (v * 100).toFixed(1) + " %";

  // TRAD
  document.getElementById("vTrad").innerText = "Valeur stock : " + fmt(res.trad.valeur);
  document.getElementById("mTrad").innerText = "Marge réelle : " + pct(res.trad.marge);

  // FE
  document.getElementById("vFE").innerText = "Valeur stock : " + fmt(res.fe.valeur);
  document.getElementById("mFE").innerText = "Marge réelle : " + pct(res.fe.marge);

  // LS
  document.getElementById("vLS").innerText = "Valeur stock : " + fmt(res.ls.valeur);
  document.getElementById("mLS").innerText = "Marge réelle : " + pct(res.ls.marge);

  // TOTAL
  document.getElementById("vTotal").innerText = "Valeur totale stock : " + fmt(res.total.valeur);
  document.getElementById("mTotal").innerText = "Marge totale : " + pct(res.total.marge);
}

/**************************************************
 * REMPLIT UN TABLEAU (TRAD / FE / LS)
 **************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  tb.innerHTML = "";

  const fmt = n => Number(n).toLocaleString("fr-FR", { style:"currency", currency:"EUR" });

  items.forEach(a => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${a.plu || a.gencode || ""}</td>
      <td>${a.designation}</td>
      <td>${a.stockKg.toFixed(2)} kg</td>
      <td>${fmt(a.pma)}</td>
      <td>${(a.marginReal * 100).toFixed(1)}%</td>
      <td>${fmt(a.pvHT || 0)}</td>
      <td>${fmt(a.pvTTC || 0)}</td>
      <td>${fmt(a.valeurStock)}</td>
    `;

    tb.appendChild(tr);
  });
}


/**************************************************
 * CHARGER TOUS LES LOTS ET CONSTRUIRE LES TABLEAUX
 **************************************************/
async function loadStock() {

  const lotsSnap = await getDocs(collection(db, "lots"));
  const map = {}; // regroupement par article

  // 1) Grouper par article
  lotsSnap.forEach(d => {
    const l = d.data();
    const key = makeKey(l);

    if (!map[key]) {
      map[key] = {
        designation: l.designation,
        plu: l.plu || "",
        gencode: l.gencode || "",
        lots: [],
      };
    }

    map[key].lots.push(l);
  });

  // 2) Calcul par groupe + tri TRAD / FE / LS
  const groupsTRAD = [];
  const groupsFE   = [];
  const groupsLS   = [];

  let resume = {
    trad: { valeur:0, marge:0, pv:0 },
    fe:   { valeur:0, marge:0 },
    ls:   { valeur:0, marge:0 },
    total:{ valeur:0, marge:0 }
  };

  for (const [key, article] of Object.entries(map)) {

    // PMA
    const pma = computePMA(article.lots);
    if (pma.poids === 0) continue;

    // Charger prix réels
    const settings = await loadRealPrice(key);
    const pvHT  = settings?.pvHT  || 0;
    const pvTTC = settings?.pvTTC || 0;

    // Valeur stock
    const valeurStock = pma.poids * pma.pma;

    // Marge réelle
    const marginReal = computeRealMargin(pvHT, pma.pma);

    const item = {
      designation: article.designation,
      plu: article.plu,
      gencode: article.gencode,
      stockKg: pma.poids,
      pma: pma.pma,
      pvHT,
      pvTTC,
      valeurStock,
      marginReal
    };

    // Catégorie
    const cat = detectCategory(article);

    if (cat === "trad") groupsTRAD.push(item);
    if (cat === "fe")   groupsFE.push(item);
    if (cat === "ls")   groupsLS.push(item);

    resume.total.valeur += valeurStock;
  }

  // 3) ATtribuer marges moyennes pondérées
  function computeCatResume(list) {
    if (list.length === 0) return { valeur:0, marge:0 };

    let totalVal = 0;
    let totalValPV = 0;

    list.forEach(a => {
      totalVal += a.valeurStock;
      totalValPV += a.pvHT * a.stockKg;
    });

    const marge = totalValPV > 0 ? (totalValPV - totalVal) / totalValPV : 0;
    return { valeur: totalVal, marge };
  }

  resume.trad = computeCatResume(groupsTRAD);
  resume.fe   = computeCatResume(groupsFE);
  resume.ls   = computeCatResume(groupsLS);
  resume.total = computeCatResume([...groupsTRAD, ...groupsFE, ...groupsLS]);

  // 4) Mettre à jour header
  updateHeader(resume);

  // 5) Remplir tableaux
  fillTable("tbody-trad", groupsTRAD);
  fillTable("tbody-fe", groupsFE);
  fillTable("tbody-ls", groupsLS);
}

/**************************************************
 * INIT
 **************************************************/
document.getElementById("btnSaveMargins").addEventListener("click", saveMargins);

await loadMargins();
await loadStock();

