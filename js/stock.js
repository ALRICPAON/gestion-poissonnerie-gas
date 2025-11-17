import { db } from "./firebase-init.js";
import {
  collection, getDocs, doc, setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("DEBUG: stock.js chargé !");

/********************************************
 * 1) Catégorie TRAD / FE / LS (SÉCURISÉ)
 ********************************************/
function detectCategory(article) {
  const d = String(article.designation || "").toUpperCase();
  const plu = String(article.plu || "");
  const gencode = String(article.gencode || "");

  if (gencode.length >= 12) return "LS";
  if (d.startsWith("FE")) return "FE";
  return "TRAD";
}

/********************************************
 * 2) PMA FIFO (SÉCURISÉ)
 ********************************************/
function computePMA(lots) {
  let totalKg = 0;
  let totalHT = 0;

  for (const l of lots) {
    totalKg += Number(l.poidsKg || 0);
    totalHT += Number(l.montantHT || 0);
  }

  return {
    poids: totalKg,
    pma: totalKg > 0 ? totalHT / totalKg : 0
  };
}

/********************************************
 * 3) TABLEAU
 ********************************************/
function fillTable(tbodyId, items) {
  const tb = document.getElementById(tbodyId);
  tb.innerHTML = "";

  const fmt = n => Number(n).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR"
  });

  items.forEach(a => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${a.plu || a.gencode || ""}</td>
      <td>${a.designation}</td>
      <td>${a.stockKg.toFixed(2)} kg</td>
      <td>${fmt(a.pma)}</td>
      <td>${(a.margeTheo * 100).toFixed(1)}%</td>
      <td>${fmt(a.pvTTCconseille)}</td>

      <td>
        <input 
          type="number" 
          step="0.01"
          value="${a.pvTTCreel || ""}"
          data-key="${a.key}"
          class="pv-reel-input"
          style="width:80px"
        >
      </td>

      <td>${fmt(a.valeurStockHT)}</td>
    `;

    tb.appendChild(tr);
  });

  // PV réel → Firestore
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
    });
  });
}

/********************************************
 * 4) CHARGEMENT GLOBAL — VERSION SÛRE
 ********************************************/

async function loadStock() {
  console.log("DEBUG: Chargement lots…");

  try {
    // 1) Charger les lots
    const snapLots = await getDocs(collection(db, "lots"));
    console.log("DEBUG: Lots récupérés =", snapLots.size);

    // 2) Charger les PV réels
    const snapPV = await getDocs(collection(db, "stock_articles"));
    console.log("DEBUG: PV réels récupérés =", snapPV.size);

    const pvMap = {};
    snapPV.forEach(d => pvMap[d.id] = d.data());

    const trad = [];
    const fe = [];
    const ls = [];

    const margeTrad = Number(localStorage.getItem("margeTrad") || 35) / 100;
    const margeFE = Number(localStorage.getItem("margeFE") || 40) / 100;
    const margeLS = Number(localStorage.getItem("margeLS") || 30) / 100;

    console.log("DEBUG: Début parsing lots…");

    snapLots.forEach(docLot => {
      const lot = docLot.data();
      console.log("DEBUG: Lot =", docLot.id, lot);

      let article = lot.article;

// 🔥 Correction : support des anciens lots (pas de lot.article)
if (!article) {
    article = {
        designation : lot.designation || "",
        plu         : lot.plu || "", 
        gencode     : lot.gencode || "",
        nomLatin    : lot.nomLatin || "",
        fao         : lot.fao || "",
        engin       : lot.engin || ""
    };
}

      const key = docLot.id;

      const cat = detectCategory(article);
      console.log("DEBUG: Cat =", cat, "pour", article.designation);

      const pma = computePMA([lot]);
      console.log("DEBUG: PMA =", pma);

      const m = cat === "TRAD" ? margeTrad :
                cat === "FE"   ? margeFE :
                margeLS;

      const pvHT = pma.pma * (m + 1);
      const pvTTC = pvHT * 1.055;

      const item = {
        key,
        designation: article.designation || "",
        plu: article.plu || "",
        gencode: article.gencode || "",
        stockKg: pma.poids,
        pma: pma.pma,
        margeTheo: m,
        pvTTCconseille: pvTTC,
        pvTTCreel: pvMap[key]?.pvTTCreel || "",
        valeurStockHT: pma.pma * pma.poids
      };

      if (cat === "TRAD") trad.push(item);
      else if (cat === "FE") fe.push(item);
      else ls.push(item);
    });

    console.log("DEBUG: Résultat final =", { trad, fe, ls });

    fillTable("tbody-trad", trad);
    fillTable("tbody-fe", fe);
    fillTable("tbody-ls", ls);
    console.log("DEBUG: Tableaux remplis !");
  }

  catch (err) {
    console.error("🔥 ERREUR DANS loadStock :", err);
  }
}

loadStock();

