import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("DEBUG: stock.js chargé !");

/************************************************************
 * 1️⃣  Clé d’article (PLU / GENCODE / Désignation)
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
 * 2️⃣  Détection catégorie : TRAD / FE / LS
 ************************************************************/
function detectCategory(article) {
  const d = String(article.designation || "").toUpperCase();
  const g = String(article.gencode || "");

  if (g && g.length >= 12) return "LS";
  if (d.startsWith("FE")) return "FE";
  return "TRAD";
}

/************************************************************
 * 3️⃣  Lecture des marges UI + stockage
 ************************************************************/
function getMarginRate(code, def) {
  const idInput = {
    trad: "marge-trad",
    fe: "marge-fe",
    ls: "marge-ls"
  }[code];

  let val = null;

  if (idInput) {
    const el = document.getElementById(idInput);
    if (el && el.value !== "") {
      val = Number(el.value);
    }
  }

  if (val == null || isNaN(val)) {
    const stored = localStorage.getItem("marge-" + code);
    if (stored != null && stored !== "") {
      val = Number(stored);
    }
  }

  if (val == null || isNaN(val)) {
    val = def;
  }

  return val / 100; // ex: 35% → 0.35
}

/************************************************************
 * 4️⃣  PMA global
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
 * 5️⃣  DLC la plus proche
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
 * 6️⃣  Tableau TRAD / FE / LS
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

    // Coloration DLC
    if (it.dlc) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const d = new Date(it.dlc);
      d.setHours(0, 0, 0, 0);

      const diffDays = (d - today) / 86400000;

      if (diffDays <= 0) tr.style.backgroundColor = "#ffcccc";      // rouge
      else if (diffDays <= 2) tr.style.backgroundColor = "#ffe7b3"; // orange
    }

    tb.appendChild(tr);
  });

  
  // Mise à jour PV réel
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

    // Feedback visuel
    e.target.classList.add("saved");
    setTimeout(() => e.target.classList.remove("saved"), 800);

    // 🔁 Recalcul sans perdre la position
    const scrollY = window.scrollY;
    await loadStock();
    window.scrollTo(0, scrollY);
  });
});
}

/************************************************************
 * 7️⃣  Chargement du stock
 ************************************************************/
async function loadStock() {
  console.log("DEBUG: Chargement lots…");

  const snapLots = await getDocs(collection(db, "lots"));
  const snapPV = await getDocs(collection(db, "stock_articles"));

  const pvMap = {};
  snapPV.forEach(d => (pvMap[d.id] = d.data()));

  const regroup = {};

  snapLots.forEach(docLot => {
    const lot = docLot.data();

    const article = {
      designation: lot.designation || "",
      plu: lot.plu || "",
      gencode: lot.gencode || "",
      nomLatin: lot.nomLatin || "",
      fao: lot.fao || lot.zone || "",
      dlc: lot.dlc || lot.dltc || "",
      engin: lot.engin || ""
    };

    const key = articleKey(article);

    if (!regroup[key]) regroup[key] = { article, lots: [] };
    regroup[key].lots.push(lot);
  });

  const margeTrad = getMarginRate("trad", 35);
  const margeFE = getMarginRate("fe", 40);
  const margeLS = getMarginRate("ls", 30);

  const trad = [];
  const fe = [];
  const ls = [];

  for (const key in regroup) {
    const { article, lots } = regroup[key];

    // Correction DLC : dltc → dlc
    lots.forEach(l => {
      l.dlc = l.dlc || l.dltc || "";
    });

    const pmaData = computeGlobalPMA(lots);
    if (pmaData.stockKg <= 0 || pmaData.pma <= 0) continue;

    const cat = detectCategory(article);

    const m =
      cat === "TRAD" ? margeTrad : cat === "FE" ? margeFE : margeLS;

    // PV conseillé avec marge HT correcte
    const pvHTconseille = pmaData.pma / (1 - m);
    const pvTTCconseille = pvHTconseille * 1.055;

    const pvTTCreel =
      pvMap[key]?.pvTTCreel != null ? Number(pvMap[key].pvTTCreel) : null;

    const margeTheo =
      pvHTconseille > 0 ? (pvHTconseille - pmaData.pma) / pvHTconseille : 0;

    let margeReelle = null;
    if (typeof pvTTCreel === "number" && pvTTCreel > 0) {
      const pvHTReel = pvTTCreel / 1.055;
      margeReelle = (pvHTReel - pmaData.pma) / pvHTReel;
    }

    const dlcClosest = getClosestDLC(lots);
    const dlcStr = dlcClosest
      ? dlcClosest.toISOString().split("T")[0]
      : "";

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

  fillTable("tbody-trad", trad);
  fillTable("tbody-fe", fe);
  fillTable("tbody-ls", ls);

  updateTotaux(trad, fe, ls);
}

/************************************************************
 * 🔟 Totaux TRAD / FE / LS
 ************************************************************/
function updateTotaux(trad, fe, ls) {
  const fmt = n =>
    Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

  function calc(arr, divId) {
    const div = document.getElementById(divId);
    if (!div) return;

    let achatHT = 0;
    let venteTTC = 0;

    arr.forEach(it => {
      achatHT += it.valeurStockHT;
      const pv = it.pvTTCreel || it.pvTTCconseille || 0;
      venteTTC += pv * it.stockKg;
    });

    const venteHT = venteTTC / 1.055;
    const marge = venteHT > 0 ? ((venteHT - achatHT) / venteHT) * 100 : 0;

    div.querySelector(".aht").textContent = fmt(achatHT);
    div.querySelector(".vtc").textContent = fmt(venteTTC);
    div.querySelector(".marge").textContent = marge.toFixed(1) + " %";
  }

  calc(trad, "totaux-trad");
  calc(fe,   "totaux-fe");
  calc(ls,   "totaux-ls");
}

/************************************************************
 * 1️⃣1️⃣  UI des marges
 ************************************************************/
function initMarginUI() {
  const elTrad = document.getElementById("marge-trad");
  const elFE = document.getElementById("marge-fe");
  const elLS = document.getElementById("marge-ls");
  const btnSave = document.getElementById("save-marges");

  if (elTrad) elTrad.value = localStorage.getItem("marge-trad") || "35";
  if (elFE)   elFE.value = localStorage.getItem("marge-fe") || "40";
  if (elLS)   elLS.value = localStorage.getItem("marge-ls") || "30";

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      if (elTrad) localStorage.setItem("marge-trad", elTrad.value || "35");
      if (elFE)   localStorage.setItem("marge-fe", elFE.value || "40");
      if (elLS)   localStorage.setItem("marge-ls", elLS.value || "30");

      alert("Marges enregistrées");
      loadStock();
    });
  }
}

/************************************************************
 * 1️⃣2️⃣  Lancement
 ************************************************************/
initMarginUI();
loadStock();
