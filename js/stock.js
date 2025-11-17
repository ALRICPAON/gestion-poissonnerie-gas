/**************************************************
 *  STOCK.JS – Module Stock Poissonnerie (version corrigée)
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
 * 1)   RÉGLAGES MARGES (global)
 **************************************************/
const marginRef = doc(db, "stock_settings", "global");

async function loadMargins() {
  const snap = await getDoc(marginRef);
  if (snap.exists()) {
    const d = snap.data();
    margeTrad.value = d.trad || 35;
    margeFE.value   = d.fe   || 35;
    margeLS.value   = d.ls   || 35;
  } else {
    margeTrad.value = 35;
    margeFE.value   = 35;
    margeLS.value   = 35;
  }
}

async function saveMargins() {
  await setDoc(marginRef, {
    trad: Number(margeTrad.value),
    fe:   Number(margeFE.value),
    ls:   Number(margeLS.value)
  }, { merge:true });

  alert("Marges enregistrées !");
}


/**************************************************
 * 2)  CLÉ ARTICLE FIABLE (PLU / EAN / AUTO)
 **************************************************/
function makeKey(article) {

  // LS = gencode
  if (article.gencode && article.gencode.length === 13) {
    return "LS-" + article.gencode;
  }

  // TRAD / FE = PLU
  if (article.plu && article.plu !== "") {
    return "PLU-" + article.plu;
  }

  // Fallback technique
  return "AUTO-" + (article.achatId || "A") + "-" + (article.ligneId || "L");
}


/**************************************************
 * 3)  Détection catégorie article
 **************************************************/
function detectCategory(article) {
  const g = article.gencode || "";
  const d = (article.designation || "").toUpperCase();

  if (g.length === 13) return "ls";
  if (d.startsWith("FE.")) return "fe";

  return "trad";
}


/**************************************************
 * 4)  CALCUL PMA (prix moyen d’achat basé sur lots)
 **************************************************/
function computePMA(lots) {
  let totalPoids = 0;
  let totalCost  = 0;

  for (const lot of lots) {
    const p = Number(lot.poidsRestant || lot.poidsKg || 0);
    const pa = Number(lot.prixHTKg || lot.prixAchatKg || 0);

    totalPoids += p;
    totalCost  += p * pa;
  }

  if (totalPoids === 0) return { pma: 0, poids: 0 };
  return { pma: totalCost / totalPoids, poids: totalPoids };
}


/**************************************************
 * 5)  LIRE prix réel → stock_articles/{key}
 **************************************************/
async function loadRealPrice(key) {
  const r = await getDoc(doc(db, "stock_articles", key));
  return r.exists() ? r.data() : null;
}


/**************************************************
 * 6)  CALCUL marge réelle HT
 **************************************************/
function computeRealMargin(pvHT, pma) {
  if (!pvHT || pvHT <= 0) return 0;
  return (pvHT - pma) / pvHT;
}


/**************************************************
 * 7)  Mettre à jour header valeurs & marges totales
 **************************************************/
function updateHeader(res) {
  const fmt = v => Number(v).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR"
  });
  const pct = v => (v * 100).toFixed(1) + " %";

  vTrad.innerText  = "Valeur stock : " + fmt(res.trad.valeur);
  mTrad.innerText  = "Marge réelle : " + pct(res.trad.marge);

  vFE.innerText    = "Valeur stock : " + fmt(res.fe.valeur);
  mFE.innerText    = "Marge réelle : " + pct(res.fe.marge);

  vLS.innerText    = "Valeur stock : " + fmt(res.ls.valeur);
  mLS.innerText    = "Marge réelle : " + pct(res.ls.marge);

  vTotal.innerText = "Valeur totale : " + fmt(res.total.valeur);
  mTotal.innerText = "Marge totale : "  + pct(res.total.marge);
}


/**************************************************
 * 8)  Affichage tableaux TRAD / FE / LS
 **************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  tb.innerHTML = "";

  const fmt = n => Number(n).toLocaleString("fr-FR", {
    style:"currency",
    currency:"EUR"
  });

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
 * 9)  Charger tout le stock depuis LOTS
 **************************************************/
async function loadStock() {

  const lotsSnap = await getDocs(collection(db, "lots"));
  const map = {};

  // Regroupement par article
  for (const d of lotsSnap.docs) {
    const l = d.data();
    const key = makeKey(l);

    if (!map[key]) {
      map[key] = {
        key,
        designation: l.designation || "",
        plu: l.plu || "",
        gencode: l.gencode || "",
        achatId: l.achatId,
        ligneId: l.ligneId,
        lots: []
      };
    }

    map[key].lots.push(l);
  }

  const groupsTRAD = [];
  const groupsFE   = [];
  const groupsLS   = [];

  let resume = {
    trad:  { valeur:0, marge:0 },
    fe:    { valeur:0, marge:0 },
    ls:    { valeur:0, marge:0 },
    total: { valeur:0, marge:0 }
  };

  for (const [key, article] of Object.entries(map)) {

    const pma = computePMA(article.lots);
    if (pma.poids === 0) continue;

    const settings = await loadRealPrice(key);
    const pvHT  = settings?.pvHT  || 0;
    const pvTTC = settings?.pvTTC || 0;

    const valeurStock = pma.poids * pma.pma;
    const marginReal  = computeRealMargin(pvHT, pma.pma);

    const item = {
      key,
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

    const cat = detectCategory(article);

    if (cat === "trad") groupsTRAD.push(item);
    if (cat === "fe")   groupsFE.push(item);
    if (cat === "ls")   groupsLS.push(item);
  }

  function computeCatResume(list) {
    if (!list.length) return { valeur:0, marge:0 };
    let totalVal = 0;
    let totalPV  = 0;

    list.forEach(a => {
      totalVal += a.valeurStock;
      totalPV  += a.pvHT * a.stockKg;
    });

    const marge = totalPV > 0 ? (totalPV - totalVal) / totalPV : 0;
    return { valeur: totalVal, marge };
  }

  resume.trad  = computeCatResume(groupsTRAD);
  resume.fe    = computeCatResume(groupsFE);
  resume.ls    = computeCatResume(groupsLS);
  resume.total = computeCatResume([...groupsTRAD, ...groupsFE, ...groupsLS]);

  updateHeader(resume);

  fillTable("tbody-trad", groupsTRAD);
  fillTable("tbody-fe",   groupsFE);
  fillTable("tbody-ls",   groupsLS);
}


/**************************************************
 * 10) INIT
 **************************************************/
btnSaveMargins.addEventListener("click", saveMargins);

await loadMargins();
await loadStock();

