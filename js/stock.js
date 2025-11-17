import { db } from "./firebase-init.js";
import {
  collection, getDocs, doc, setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("DEBUG: stock.js chargé !");

/************************************************************
 *   1️⃣  Génère une clé unique pour un article
 ************************************************************/
function articleKey(article) {
  if (article.gencode) return "LS_" + article.gencode;
  if (article.plu) return "PLU_" + article.plu;

  // fallback designation
  return "DESC_" + String(article.designation || "")
    .replace(/\s+/g, "_")
    .replace(/[^\w]+/g, "")
    .toUpperCase();
}

/************************************************************
 *   2️⃣  Détection catégorie (TRAD / FE / LS)
 ************************************************************/
function detectCategory(article) {
  const d = String(article.designation || "").toUpperCase();

  if (article.gencode && article.gencode.length >= 12) return "LS";
  if (d.startsWith("FE")) return "FE";

  return "TRAD";
}

/************************************************************
 *   3️⃣  PMA GLOBAL SUR TOUS LES LOTS RESTANTS DU MÊME ARTICLE
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
 *   4️⃣  Construction et affichage des tableaux
 ************************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  tb.innerHTML = "";

  const fmt = n => Number(n).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR"
  });

  for (const it of items) {
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
          value="${it.pvTTCreel || ""}"
          data-key="${it.key}"
          class="pv-reel-input"
          style="width:80px"
        >
      </td>

      <td>${fmt(it.valeurStockHT)}</td>
    `;

    tb.appendChild(tr);
  }

  // Événements pour mise à jour du PV TTC réel
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

      console.log("PV réel mis à jour pour", key, "=", val);
    });
  });
}

/************************************************************
 *   5️⃣  Chargement global du stock (vrai PMA)
 ************************************************************/
async function loadStock() {
  console.log("DEBUG: Chargement lots…");

  const snapLots = await getDocs(collection(db, "lots"));
  const snapPV   = await getDocs(collection(db, "stock_articles"));

  // Map PV réel stockés
  const pvMap = {};
  snapPV.forEach(d => pvMap[d.id] = d.data());

  // Regroupement des lots par article key
  const regroup = {};

  snapLots.forEach(docLot => {
    const lot = docLot.data();

    // Génère un objet article compatible
    const article = {
      designation : lot.designation || "",
      plu         : lot.plu || "",
      gencode     : lot.gencode || "",
      nomLatin    : lot.nomLatin || "",
      fao         : lot.fao || "",
      engin       : lot.engin || ""
    };

    const key = articleKey(article);

    if (!regroup[key]) regroup[key] = { article, lots: [], lotIds: [] };

    regroup[key].lots.push(lot);
    regroup[key].lotIds.push(docLot.id);
  });

  // Chargement des marges
  const margeTrad = Number(localStorage.getItem("margeTrad") || 35) / 100;
  const margeFE   = Number(localStorage.getItem("margeFE") || 40) / 100;
  const margeLS   = Number(localStorage.getItem("margeLS") || 30) / 100;

  const trad = [];
  const fe   = [];
  const ls   = [];

  // Construction des lignes
  for (const key in regroup) {
    const { article, lots, lotIds } = regroup[key];

    const pma = computeGlobalPMA(lots);

    const cat = detectCategory(article);

    const m = cat === "TRAD" ? margeTrad :
              cat === "FE"   ? margeFE   :
                               margeLS;

    const pvHT = pma.pma * (1 + m);
    const pvTTC = pvHT * 1.055;

    // On prend un PV réel si existant (on prend le premier lot)
    const pvReal = pvMap[lotIds[0]]?.pvTTCreel || "";

    const item = {
      key,
      designation: article.designation,
      plu: article.plu,
      gencode: article.gencode,
      stockKg: pma.stockKg,
      pma: pma.pma,
      margeTheo: m,
      pvTTCconseille: pvTTC,
      pvTTCreel: pvReal,
      valeurStockHT: pma.pma * pma.stockKg
    };

    if (cat === "TRAD") trad.push(item);
    if (cat === "FE")   fe.push(item);
    if (cat === "LS")   ls.push(item);
  }

  // Affichage tableaux
  fillTable("tbody-trad", trad);
  fillTable("tbody-fe", fe);
  fillTable("tbody-ls", ls);

  console.log("DEBUG: Stock affiché !");
}

loadStock();
