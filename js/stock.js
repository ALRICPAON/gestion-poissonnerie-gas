import { db } from "./firebase-init.js";
import {
  collection, getDocs, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const el = {
  margeTrad: document.getElementById("margeTrad"),
  margeFE:   document.getElementById("margeFE"),
  margeLS:   document.getElementById("margeLS"),
  btnSave:   document.getElementById("btnSaveMargins"),

  tbodyTrad: document.getElementById("tbody-trad"),
  tbodyFE:   document.getElementById("tbody-fe"),
  tbodyLS:   document.getElementById("tbody-ls"),

  totTrad:   document.getElementById("totaux-trad"),
  totFE:     document.getElementById("totaux-fe"),
  totLS:     document.getElementById("totaux-ls"),
};

// TVA par défaut si tu n'as pas encore de TVA par article
const TVA_TRAD_FE = 0.055;
const TVA_LS      = 0.10;  // tu ajusteras

function detectCategory(plu, gencode, designation) {
  const cleanDes = (designation || "").toUpperCase().trim();

  if (gencode && /^[0-9]{8}$|^[0-9]{13}$/.test(gencode)) return "LS";

  if (cleanDes.startsWith("FE ") ||
      cleanDes.startsWith("FE.") ||
      cleanDes.startsWith("FE-") ||
      cleanDes.startsWith("FE_")) return "FE";

  return "TRAD";
}

function formatMoney(v) {
  const n = Number(v || 0);
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/** Charge les paramètres globaux de marge */
async function loadGlobalSettings() {
  const ref = doc(db, "stock_settings", "global");
  const snap = await getDoc(ref);

  let data = {
    margeDefaultTrad: 0.35,
    margeDefaultFE:   0.28,
    margeDefaultLS:   0.40
  };

  if (snap.exists()) {
    data = { ...data, ...snap.data() };
  }

  el.margeTrad.value = (data.margeDefaultTrad * 100).toFixed(1);
  el.margeFE.value   = (data.margeDefaultFE   * 100).toFixed(1);
  el.margeLS.value   = (data.margeDefaultLS   * 100).toFixed(1);

  return data;
}

/** Sauvegarde les paramètres globaux */
async function saveGlobalSettings() {
  const data = {
    margeDefaultTrad: Number(el.margeTrad.value || 0) / 100,
    margeDefaultFE:   Number(el.margeFE.value   || 0) / 100,
    margeDefaultLS:   Number(el.margeLS.value   || 0) / 100,
  };

  const ref = doc(db, "stock_settings", "global");
  await setDoc(ref, data, { merge: true });
  alert("Marges par défaut mises à jour.");
}

/** Charge tous les lots ouverts */
async function loadLots() {
  const snap = await getDocs(collection(db, "lots"));
  const list = [];
  snap.forEach(d => {
    const r = d.data();
    if (!r.poidsRestant || r.closed) return;
    list.push({ id: d.id, ...r });
  });
  return list;
}

/** Regroupe par article (clé TRAD/FE = plu, LS = gencode) */
function groupByArticle(lots) {
  const map = {};

  for (const lot of lots) {
    const { plu, gencode, designation } = lot;
    const category = detectCategory(plu, gencode, designation);

    let articleKey;
    if (category === "LS") {
      articleKey = gencode;
    } else {
      articleKey = plu;
    }

    if (!articleKey) continue;

    if (!map[articleKey]) {
      map[articleKey] = {
        articleKey,
        plu,
        gencode,
        designation,
        category,
        lots: []
      };
    }
    map[articleKey].lots.push(lot);
  }

  return Object.values(map);
}

/** Calcule PMA, poids, PV, marge, etc. pour un article */
function computeArticleRow(article, globalSettings, articleSettingsMap = {}) {
  const { category } = article;
  const lots = article.lots;

  let totalPoids = 0;
  let sumCost = 0;

  for (const lot of lots) {
    const p = Number(lot.poidsRestant || 0);
    const c = Number(lot.prixAchatKg || 0);
    totalPoids += p;
    sumCost += p * c;
  }

  if (totalPoids <= 0) {
    return null;
  }

  const PMA = sumCost / totalPoids;

  // marge par défaut selon catégorie
  let marge = {
    TRAD: globalSettings.margeDefaultTrad,
    FE:   globalSettings.margeDefaultFE,
    LS:   globalSettings.margeDefaultLS,
  }[category] || 0.35;

  // TVA par défaut
  let tva = (category === "LS") ? TVA_LS : TVA_TRAD_FE;

  // override éventuel article
  const artKey = article.articleKey;
  const artCfg = articleSettingsMap[artKey];

  let pvHT = null;

  if (artCfg) {
    if (typeof artCfg.tva === "number") tva = artCfg.tva;
    if (typeof artCfg.pvHT === "number" && artCfg.pvHT > 0) {
      pvHT = artCfg.pvHT;
      marge = (pvHT - PMA) / PMA;
    } else if (typeof artCfg.margePerso === "number") {
      marge = artCfg.margePerso;
    }
  }

  if (pvHT === null) {
    pvHT = PMA * (1 + marge);
  }

  const pvTTC = pvHT * (1 + tva);
  const valeurStockHT = totalPoids * PMA;
  const caTheoriqueHT = totalPoids * pvHT;
  const margeTheorique = (caTheoriqueHT - valeurStockHT) / caTheoriqueHT;

  return {
    ...article,
    totalPoids,
    PMA,
    marge,
    pvHT,
    pvTTC,
    tva,
    valeurStockHT,
    caTheoriqueHT,
    margeTheorique
  };
}

/** Affiche un bloc (TRAD/FE/LS) */
function renderBlock(rows, tbody, totContainer) {
  tbody.innerHTML = "";

  let totalPoids = 0;
  let totalStockHT = 0;
  let totalCAHT = 0;

  for (const r of rows) {
    totalPoids   += r.totalPoids;
    totalStockHT += r.valeurStockHT;
    totalCAHT    += r.caTheoriqueHT;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.plu || r.gencode || ""}</td>
      <td>${r.designation || ""}</td>
      <td>${r.totalPoids.toFixed(2)}</td>
      <td>${r.PMA.toFixed(2)} €</td>
      <td>${(r.marge * 100).toFixed(1)} %</td>
      <td>${r.pvHT.toFixed(2)} €</td>
      <td>${r.pvTTC.toFixed(2)} €</td>
      <td>${formatMoney(r.valeurStockHT)}</td>
    `;
    tbody.appendChild(tr);
  }

  let margeBloc = 0;
  if (totalCAHT > 0) {
    margeBloc = (totalCAHT - totalStockHT) / totalCAHT;
  }

  totContainer.innerHTML = `
    Poids total : <strong>${totalPoids.toFixed(2)} kg</strong><br>
    Valeur stock HT : <strong>${formatMoney(totalStockHT)}</strong><br>
    Marge théorique si vendu au PV conseillé : 
    <strong>${(margeBloc * 100).toFixed(1)} %</strong>
  `;
}

/** MAIN */
async function main() {
  const globalSettings = await loadGlobalSettings();
  const lots = await loadLots();
  const articles = groupByArticle(lots);

  // TODO: charger stock_settings/articles si tu veux gérer les overrides
  const articleSettingsMap = {}; // pour l’instant vide

  const rowsTrad = [];
  const rowsFE   = [];
  const rowsLS   = [];

  for (const article of articles) {
    const row = computeArticleRow(article, globalSettings, articleSettingsMap);
    if (!row) continue;
    if (row.category === "TRAD") rowsTrad.push(row);
    else if (row.category === "FE") rowsFE.push(row);
    else if (row.category === "LS") rowsLS.push(row);
  }

  renderBlock(rowsTrad, el.tbodyTrad, el.totTrad);
  renderBlock(rowsFE,   el.tbodyFE,   el.totFE);
  renderBlock(rowsLS,   el.tbodyLS,   el.totLS);

  el.btnSave.addEventListener("click", saveGlobalSettings);
}

main().catch(err => {
  console.error(err);
  alert("Erreur chargement stock : " + err.message);
});
