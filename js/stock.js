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

  // fallback sur la désignation
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
 * 3️⃣  Lecture des marges depuis UI ou localStorage
 ************************************************************/
function getMarginRate(code, def) {
  const idInput = {
    trad: "marge-trad",
    fe: "marge-fe",
    ls: "marge-ls"
  }[code];

  let val = null;

  // 1) Priorité aux inputs HTML si présents
  if (idInput) {
    const el = document.getElementById(idInput);
    if (el && el.value !== "") {
      val = Number(el.value);
    }
  }

  // 2) Sinon localStorage
  if (val == null || isNaN(val)) {
    const stored = localStorage.getItem("marge-" + code);
    if (stored != null && stored !== "") {
      val = Number(stored);
    }
  }

  // 3) Sinon valeur par défaut
  if (val == null || isNaN(val)) {
    val = def;
  }

  return val / 100; // retourne le taux (ex: 0.35)
}

/************************************************************
 * 4️⃣  PMA global : somme de tous les lots restants
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
 * 5️⃣  Récupération DLC la plus proche parmi les lots
 ************************************************************/
function getClosestDLC(lots) {
  let dlcClosest = null;

  for (const lot of lots) {
    const raw = lot.dlc;
    if (!raw) continue;

    let d = null;

    if (raw.toDate) {
      // Firestore Timestamp
      d = raw.toDate();
    } else {
      d = new Date(raw);
    }

    if (!d || isNaN(d.getTime())) continue;

    if (!dlcClosest || d < dlcClosest) {
      dlcClosest = d;
    }
  }

  return dlcClosest;
}

/************************************************************
 * 6️⃣  Affichage d’un tableau (TRAD / FE / LS)
 ************************************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;

  tb.innerHTML = "";

  const fmt = (n) =>
    Number(n).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR"
    });

  items.forEach((it) => {
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
      <td>${it.dlc || ""}</td>

      <td>${fmt(it.valeurStockHT)}</td>
    `;

    // ⚠️ Coloration selon DLC
    if (it.dlc) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const d = new Date(it.dlc);
      d.setHours(0, 0, 0, 0);

      const diffDays = (d - today) / (1000 * 60 * 60 * 24);

      if (diffDays <= 0) {
        // Jour J ou dépassé
        tr.style.backgroundColor = "#ffcccc"; // rouge clair
      } else if (diffDays <= 2) {
        // J-1, J-2
        tr.style.backgroundColor = "#ffe7b3"; // orange clair
      }
    }

    tb.appendChild(tr);
  });

  // Gestion de la saisie du PV TTC réel
  document.querySelectorAll(".pv-reel-input").forEach((inp) => {
    inp.addEventListener("change", async (e) => {
      const key = e.target.dataset.key;
      const val = Number(e.target.value);

      if (isNaN(val)) return;

      // Stocker le PV TTC réel par article (clé article)
      await setDoc(
        doc(db, "stock_articles", key),
        { pvTTCreel: val },
        { merge: true }
      );

      console.log("PV TTC réel mis à jour pour", key, "=", val);

      // Recharger pour recalculer marges + couleurs
      loadStock();
    });
  });
}

/************************************************************
 * 7️⃣  Chargement global du stock (PMA + Marges + DLC)
 ************************************************************/
async function loadStock() {
  console.log("DEBUG: Chargement lots…");

  const snapLots = await getDocs(collection(db, "lots"));
  const snapPV = await getDocs(collection(db, "stock_articles"));

  // Map des PV réels par clé article
  const pvMap = {};
  snapPV.forEach((d) => {
    pvMap[d.id] = d.data();
  });

  // Regrouper tous les lots par article
  const regroup = {};

  snapLots.forEach((docLot) => {
    const lot = docLot.data();

    // Construire un objet article compatible
    const article = {
      designation: lot.designation || "",
      plu: lot.plu || "",
      gencode: lot.gencode || "",
      nomLatin: lot.nomLatin || "",
      fao: lot.fao || lot.zone || "",
      engin: lot.engin || ""
    };

    const key = articleKey(article);

    if (!regroup[key]) {
      regroup[key] = {
        article,
        lots: []
      };
    }

    regroup[key].lots.push(lot);
  });

  // Marges par défaut (TRAD / FE / LS)
  const margeTrad = getMarginRate("trad", 35);
  const margeFE = getMarginRate("fe", 40);
  const margeLS = getMarginRate("ls", 30);

  const trad = [];
  const fe = [];
  const ls = [];

  // Construire chaque ligne article
  for (const key in regroup) {
    const { article, lots } = regroup[key];

    const pmaData = computeGlobalPMA(lots);
    if (pmaData.stockKg <= 0 || pmaData.pma <= 0) continue;

    const cat = detectCategory(article);

    const m =
      cat === "TRAD" ? margeTrad : cat === "FE" ? margeFE : margeLS;

    const pvHTconseille = pmaData.pma * (1 + m);
    const pvTTCconseille = pvHTconseille * 1.055;

    const pvRealDoc = pvMap[key]?.pvTTCreel;
    const pvTTCreel =
      pvRealDoc != null && !isNaN(Number(pvRealDoc))
        ? Number(pvRealDoc)
        : null;

    // Marge théorique basée sur PV conseillé
    const margeTheo =
      pvHTconseille > 0
        ? (pvHTconseille - pmaData.pma) / pvHTconseille
        : 0;

    // Marge réelle basée sur PV réel (si renseigné)
    let margeReelle = null;
    if (pvTTCreel && pvTTCreel > 0) {
      const pvHTReel = pvTTCreel / 1.055;
      margeReelle =
        pvHTReel > 0 ? (pvHTReel - pmaData.pma) / pvHTReel : null;
    }

    // DLC la plus proche
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

  // Afficher les 3 tableaux
  fillTable("tbody-trad", trad);
  fillTable("tbody-fe", fe);
  fillTable("tbody-ls", ls);
}

/************************************************************
 * 8️⃣  Initialisation UI marges (si inputs présents)
 ************************************************************/
function initMarginUI() {
  const elTrad = document.getElementById("marge-trad");
  const elFE = document.getElementById("marge-fe");
  const elLS = document.getElementById("marge-ls");
  const btnSave = document.getElementById("save-marges");

  if (elTrad) {
    elTrad.value =
      localStorage.getItem("marge-trad") || "35";
  }
  if (elFE) {
    elFE.value =
      localStorage.getItem("marge-fe") || "40";
  }
  if (elLS) {
    elLS.value =
      localStorage.getItem("marge-ls") || "30";
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      if (elTrad) localStorage.setItem("marge-trad", elTrad.value || "35");
      if (elFE) localStorage.setItem("marge-fe", elFE.value || "40");
      if (elLS) localStorage.setItem("marge-ls", elLS.value || "30");

      alert("Marges enregistrées");
      loadStock();
    });
  }
}

/************************************************************
 * 9️⃣  Lancement
 ************************************************************/
initMarginUI();
loadStock();
