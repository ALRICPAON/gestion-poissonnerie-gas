import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("DEBUG: stock.js chargé !");

/************************************************************
 * 1️⃣  Détection rayon TRAD / FE / LS (basé sur Firestore)
 ************************************************************/
function detectCategory(article) {
  if (article.rayon) {
    const r = String(article.rayon).toLowerCase();
    if (r === "trad") return "TRAD";
    if (r === "fe")   return "FE";
    if (r === "ls")   return "LS";
  }
  return "TRAD"; // fallback sécurité
}

/************************************************************
 * 2️⃣  Clé d'article (inchangé)
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
    if (el && el.value !== "") val = Number(el.value);
  }

  if (val == null || isNaN(val)) {
    const stored = localStorage.getItem("marge-" + code);
    if (stored != null && stored !== "") val = Number(stored);
  }

  if (val == null || isNaN(val)) val = def;

  return val / 100;
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
 * 6️⃣  TABLEAU final TRAD / FE / LS
 ************************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;

  /* --------------------------------------------------------
   * 🔒 1) Sauvegarde de l’input actif (pour TAB)
   * ------------------------------------------------------ */
  const active = document.activeElement;
  let restore = null;

  if (active && active.classList.contains("pv-reel-input")) {
    restore = {
      key: active.dataset.key,
      value: active.value
    };
  }

  /* --------------------------------------------------------
   * 🔤 2) Tri alphabétique AVANT affichage
   * ------------------------------------------------------ */
  items.sort((a, b) =>
    (a.designation || "").localeCompare(b.designation || "", "fr", { sensitivity: "base" })
  );

  /* --------------------------------------------------------
   * 🧽 3) Reset tableau
   * ------------------------------------------------------ */
  tb.innerHTML = "";

  const fmt = n =>
    Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

  /* --------------------------------------------------------
   * 🖨️ 4) Impression lignes
   * ------------------------------------------------------ */
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

    // 🔥 Coloration DLC
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

  /* --------------------------------------------------------
   * 💾 5) Sauvegarde PV réel
   * ------------------------------------------------------ */
  document.querySelectorAll(".pv-reel-input").forEach(inp => {
    inp.addEventListener("change", async e => {
      const key = e.target.dataset.key;
      const val = Number(e.target.value);
      if (isNaN(val)) return;

      await setDoc(doc(db, "stock_articles", key), { pvTTCreel: val }, { merge: true });

      const scrollY = window.scrollY;

      document.activeElement.blur();
      await loadStock();

      window.scrollTo(0, scrollY);
    });
  });

  /* --------------------------------------------------------
   * 🔁 6) Restauration du focus (TAB correct)
   * ------------------------------------------------------ */
  if (restore) {
    const elem = document.querySelector(`.pv-reel-input[data-key="${restore.key}"]`);
    if (elem) {
      elem.focus();
      elem.select();
    }
  }
}

/************************************************************
 * 7️⃣  CHARGEMENT du STOCK
 ************************************************************/
async function loadStock() {
  console.log("DEBUG: Chargement lots…");

  const snapLots = await getDocs(collection(db, "lots"));
  const snapPV = await getDocs(collection(db, "stock_articles"));

  const pvMap = {};
  snapPV.forEach(d => (pvMap[d.id] = d.data()));

  const regroup = {};

  // --- Correction DESIGNATION & RAYON depuis FICHE ARTICLE ---
  async function enrichArticle(lot) {
    let art = { ...lot };

    if (!art.designation || !art.rayon) {
      if (lot.plu) {
        const snapArt = await getDoc(doc(db, "articles", String(lot.plu)));
        if (snapArt.exists()) {
          const A = snapArt.data();
          art.designation = art.designation || A.Designation || A.designation || "";
          art.rayon       = art.rayon       || A.rayon || "";
        }
      }
    }

    return art;
  }

  for (const docLot of snapLots.docs) {
    const lot = docLot.data();
    const art = await enrichArticle(lot);

    const article = {
      designation: art.designation || "",
      plu: art.plu || "",
      gencode: art.gencode || "",
      rayon: art.rayon || "",
      nomLatin: art.nomLatin || "",
      dlc: art.dlc || art.dltc || ""
    };

    const key = articleKey(article);

    if (!regroup[key]) regroup[key] = { article, lots: [] };
    regroup[key].lots.push(art);
  }

  const margeTrad = getMarginRate("trad", 35);
  const margeFE = getMarginRate("fe", 40);
  const margeLS = getMarginRate("ls", 30);

  let trad = [];
  let fe = [];
  let ls = [];

  for (const key in regroup) {
    const { article, lots } = regroup[key];

    lots.forEach(l => (l.dlc = l.dlc || l.dltc || ""));

    const pmaData = computeGlobalPMA(lots);
    if (pmaData.stockKg <= 0 || pmaData.pma <= 0) continue;

    const cat = detectCategory(article);

    const marge =
      cat === "TRAD" ? margeTrad :
      cat === "FE"   ? margeFE :
                       margeLS;

    const pvHTconseille = pmaData.pma / (1 - marge);
    const pvTTCconseille = pvHTconseille * 1.055;

    const pvTTCreel =
      pvMap[key]?.pvTTCreel != null ? Number(pvMap[key].pvTTCreel) : null;

    const margeTheo =
      pvHTconseille > 0 ? (pvHTconseille - pmaData.pma) / pvHTconseille : 0;

    let margeReelle = null;
    if (pvTTCreel > 0) {
      const pvHT = pvTTCreel / 1.055;
      margeReelle = (pvHT - pmaData.pma) / pvHT;
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

  // 📌 TRI ALPHABÉTIQUE
  trad.sort((a, b) => a.designation.localeCompare(b.designation));
  fe.sort((a, b) => a.designation.localeCompare(b.designation));
  ls.sort((a, b) => a.designation.localeCompare(b.designation));

  fillTable("tbody-trad", trad);
  fillTable("tbody-fe", fe);
  fillTable("tbody-ls", ls);

  updateTotaux(trad, fe, ls);
}

/************************************************************
 * 8️⃣  Totaux TRAD / FE / LS
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
 * 9️⃣  UI des marges
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
 * 🔟 Lancement
 ************************************************************/
initMarginUI();
loadStock();
