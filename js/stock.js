/**************************************************
 *  STOCK.JS — Version FINALISÉE (PMA + PV TTC conseillé)
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
 * 1) MARGES PAR DÉFAUT (stock_settings/global)
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
  }, { merge: true });

  alert("Marges enregistrées !");
}


/**************************************************
 * 2) CLÉ ARTICLE = PLU / GENCODE / AUTO
 **************************************************/
function makeKey(article) {

  const g = String(article.gencode || "");
  const p = String(article.plu || "");

  if (g.length === 13) return "LS-" + g;
  if (p !== "") return "PLU-" + p;

  return "AUTO-" + (article.achatId || "A") + "-" + (article.ligneId || "L");
}


/**************************************************
 * 3) Catégorie article (TRAD / FE / LS)
 **************************************************/
function detectCategory(article) {
  const g = String(article.gencode || "");
  const d = String(article.designation || "").toUpperCase();

  if (g.length === 13) return "ls";
  if (d.startsWith("FE.")) return "fe";

  return "trad";
}


/**************************************************
 * 4) Calcul PMA depuis lots
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
 * 5) Fonction formatage €
 **************************************************/
const fmt = v => Number(v).toLocaleString("fr-FR", {
  style: "currency",
  currency: "EUR"
});


/**************************************************
 * 6) Mise à jour du HEADER
 **************************************************/
function updateHeader(res) {
  const pct = x => (x * 100).toFixed(1) + "%";

  vTrad.innerText  = `Valeur stock : ${fmt(res.trad.valeur)}`;
  mTrad.innerText  = `Marge théorique : ${pct(res.trad.marge)}`;

  vFE.innerText    = `Valeur stock : ${fmt(res.fe.valeur)}`;
  mFE.innerText    = `Marge théorique : ${pct(res.fe.marge)}`;

  vLS.innerText    = `Valeur stock : ${fmt(res.ls.valeur)}`;
  mLS.innerText    = `Marge théorique : ${pct(res.ls.marge)}`;

  vTotal.innerText = `Valeur totale : ${fmt(res.total.valeur)}`;
  mTotal.innerText = `Marge totale : ${pct(res.total.marge)}`;
}


/**************************************************
 * 7) Remplissage des tableaux HTML
 **************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  tb.innerHTML = "";

  items.forEach(a => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${a.plu || a.gencode || ""}</td>
      <td>${a.designation}</td>
      <td>${a.stockKg.toFixed(2)} kg</td>
      <td>${fmt(a.pma)}</td>
      <td>${fmt(a.pvHTc)}</td>
      <td>${fmt(a.pvTTCc)}</td>
      <td>${(a.marginTheo * 100).toFixed(1)}%</td>
      <td>${fmt(a.valeurStock)}</td>
    `;

    tb.appendChild(tr);
  });
}


/**************************************************
 * 8) Charger TOUT le stock depuis LOTS
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

    // Catégorie
    const cat = detectCategory(article);

    // Marge par défaut
    let m = 35;
    if (cat === "trad") m = Number(margeTrad.value);
    if (cat === "fe")   m = Number(margeFE.value);
    if (cat === "ls")   m = Number(margeLS.value);

    // PV CONSEILLÉ
    const pvHTc  = pma.pma === 0 ? 0 : pma.pma / (1 - m/100);
    const pvTTCc = pvHTc * 1.055; // TVA poisson 5,5%

    const valeurStock = pma.poids * pma.pma;
    const marginTheo  = pma.pma === 0 ? 0 : (pvHTc - pma.pma) / pvHTc;

    const item = {
      key,
      designation: article.designation,
      plu: article.plu,
      gencode: article.gencode,
      stockKg: pma.poids,
      pma: pma.pma,
      pvHTc,
      pvTTCc,
      valeurStock,
      marginTheo
    };

    if (cat === "trad") groupsTRAD.push(item);
    if (cat === "fe")   groupsFE.push(item);
    if (cat === "ls")   groupsLS.push(item);
  }

  // Résumés par catégorie
  function computeCatResume(list) {
    if (!list.length) return { valeur:0, marge:0 };

    let totalVal = 0;
    let totalPV  = 0;

    list.forEach(a => {
      totalVal += a.valeurStock;
      totalPV  += a.pvHTc * a.stockKg;
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
 * 9) INIT
 **************************************************/
btnSaveMargins.addEventListener("click", saveMargins);

await loadMargins();
await loadStock();

