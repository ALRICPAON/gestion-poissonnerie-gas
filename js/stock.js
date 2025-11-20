import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("DEBUG: stock.js chargé !");

/************************************************************
 * 🔍 Clé d’article
 ************************************************************/
function articleKey(article) {
  if (article.gencode) return "LS_" + article.gencode;
  if (article.plu) return "PLU_" + article.plu;
  return (
    "DESC_" +
    String(article.designation || "")
      .replace(/\s+/g, "_")
      .replace(/[^\w]+/g, "")
      .toUpperCase()
  );
}

/************************************************************
 * 🧭 Détermination du rayon TRAD / FE / LS
 ************************************************************/
function detectCategory(article) {

  // 🔥 Rayon défini dans la fiche Article → PRIORITAIRE
  if (article.rayon) return article.rayon.toUpperCase();

  // Si Gencode long → LS
  if (article.gencode && String(article.gencode).length >= 12) return "LS";

  // Si désignation commence par FE → FE
  if (String(article.designation || "").toUpperCase().startsWith("FE"))
    return "FE";

  return "TRAD";
}

/************************************************************
 * 📦 PMA global
 ************************************************************/
function computeGlobalPMA(lots) {
  let totalKg = 0;
  let totalHT = 0;

  for (const lot of lots) {
    const kg = Number(lot.poidsRestant || 0);
    const prix = Number(lot.prixAchatKg || 0);

    totalKg += kg;
    totalHT += kg * prix;
  }

  return {
    stockKg: totalKg,
    pma: totalKg > 0 ? totalHT / totalKg : 0
  };
}

/************************************************************
 * ⏳ DLC la plus proche
 ************************************************************/
function getClosestDLC(lots) {
  let dlcClosest = null;

  for (const lot of lots) {
    const raw = lot.dlc || lot.dltc;
    if (!raw) continue;

    let d = raw.toDate ? raw.toDate() : new Date(raw);
    if (!d || isNaN(d.getTime())) continue;

    if (!dlcClosest || d < dlcClosest) dlcClosest = d;
  }

  return dlcClosest;
}

/************************************************************
 * 📝 Tableau TRAD / FE / LS
 ************************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;

  tb.innerHTML = "";

  const fmt = n =>
    Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

  items.forEach(it => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${it.plu || it.gencode || ""}</td>
      <td>${it.designation}</td>
      <td>${it.stockKg.toFixed(2)} kg</td>
      <td>${fmt(it.pma)}</td>
      <td>${(it.margeTheo * 100).toFixed(1)} %</td>
      <td>${fmt(it.pvTTCconseille)}</td>

      <td>
        <input 
          type="number"
          step="0.01"
          value="${it.pvTTCreel ?? ""}"
          data-key="${it.key}"
          class="pv-reel-input"
          style="width:80px"
        >
      </td>

      <td>${it.margeReelle != null ? (it.margeReelle * 100).toFixed(1) + " %" : ""}</td>
      <td>${it.dlc ? new Date(it.dlc + "T00:00:00").toLocaleDateString("fr-FR") : ""}</td>

      <td>${fmt(it.valeurStockHT)}</td>
    `;

    tb.appendChild(tr);
  });

  // Sauvegarde PV réel
  document.querySelectorAll(".pv-reel-input").forEach(inp => {
    inp.addEventListener("change", async e => {
      const key = e.target.dataset.key;
      const val = Number(e.target.value);
      if (isNaN(val)) return;

      await setDoc(
        doc(db, "stock_articles", key),
        { pvTTCreel: val },
        { merge: true }
      );

      await loadStock();
    });
  });
}

/************************************************************
 * 📚 Chargement du stock complet
 ************************************************************/
async function loadStock() {
  const snapLots = await getDocs(collection(db, "lots"));
  const snapArticles = await getDocs(collection(db, "articles"));
  const snapPV = await getDocs(collection(db, "stock_articles"));

  const pvMap = {};
  snapPV.forEach(d => (pvMap[d.id] = d.data()));

  // On charge toutes les fiches articles
  const articles = {};
  snapArticles.forEach(docA => {
    const a = docA.data();
    const plu = a.PLU || a.plu || docA.id;

    articles[plu] = {
      plu,
      designation: a.Designation || a.designation || "",
      nomLatin: a.NomLatin || a.nomLatin || "",
      categorie: a.Categorie || a.categorie || "",
      zone: a.Zone || a.zone || "",
      sousZone: a.SousZone || a.sousZone || "",
      engin: a.Engin || a.engin || "",
      allergenes: a.Allergenes || a.allergenes || "",
      rayon: a.rayon || a.Rayon || "",
      gencode: a.EAN || a.ean || ""
    };
  });

  const regroup = {};

  snapLots.forEach(docLot => {
    const lot = docLot.data();
    const plu = lot.plu;

    // Rattacher la fiche article
    const art = articles[plu] || {};

    const article = {
      plu,
      gencode: art.gencode || "",
      designation: art.designation || lot.designation || "",
      nomLatin: art.nomLatin || lot.nomLatin || "",
      categorie: art.categorie || "",
      zone: art.zone || lot.zone || "",
      sousZone: art.sousZone || lot.sousZone || "",
      engin: art.engin || lot.engin || "",
      rayon: art.rayon || ""
    };

    const key = articleKey(article);

    if (!regroup[key]) regroup[key] = { article, lots: [] };
    regroup[key].lots.push(lot);
  });

  // Marges
  const margeTrad = Number(localStorage.getItem("marge-trad") || 35) / 100;
  const margeFE = Number(localStorage.getItem("marge-fe") || 40) / 100;
  const margeLS = Number(localStorage.getItem("marge-ls") || 30) / 100;

  const trad = [];
  const fe = [];
  const ls = [];

  for (const key in regroup) {
    const { article, lots } = regroup[key];

    // Correction DLC
    lots.forEach(l => (l.dlc = l.dlc || l.dltc || ""));

    const pmaData = computeGlobalPMA(lots);
    if (pmaData.stockKg <= 0) continue;

    const cat = detectCategory(article);

    const m =
      cat === "TRAD" ? margeTrad : cat === "FE" ? margeFE : margeLS;

    const pvHTconseille = pmaData.pma / (1 - m);
    const pvTTCconseille = pvHTconseille * 1.055;

    const pvTTCreel =
      pvMap[key]?.pvTTCreel != null ? Number(pvMap[key].pvTTCreel) : null;

    const margeTheo =
      pvHTconseille ? (pvHTconseille - pmaData.pma) / pvHTconseille : 0;

    let margeReelle = null;
    if (pvTTCreel) {
      const pvHTreel = pvTTCreel / 1.055;
      margeReelle = (pvHTreel - pmaData.pma) / pvHTreel;
    }

    const dlcClosest = getClosestDLC(lots);
    const dlcStr = dlcClosest ? dlcClosest.toISOString().split("T")[0] : "";

    const item = {
      key,
      designation: article.designation,
      plu: article.plu,
      gencode: article.gencode,
      stockKg: pmaData.stockKg,
      pma: pmaData.pma,
      margeTheo,
      pvTTCconseille,
      pvTTCreel,
      margeReelle,
      dlc: dlcStr,
      valeurStockHT: pmaData.pma * pmaData.stockKg
    };

    if (cat === "TRAD") trad.push(item);
    else if (cat === "FE") fe.push(item);
    else ls.push(item);
  }

  // 🔤 TRI ALPHABÉTIQUE
  trad.sort((a, b) => a.designation.localeCompare(b.designation));
  fe.sort((a, b) => a.designation.localeCompare(b.designation));
  ls.sort((a, b) => a.designation.localeCompare(b.designation));

  fillTable("tbody-trad", trad);
  fillTable("tbody-fe", fe);
  fillTable("tbody-ls", ls);
}

/************************************************************
 * 🚀 Lancement
 ************************************************************/
loadStock();
