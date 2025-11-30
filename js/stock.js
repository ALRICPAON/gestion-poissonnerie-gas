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
/* ---------- PRINT STOCK REPORT (PLU / GENCODE / DESIGNATION / STOCK / PMA / PVTTC / REEL / DLC) ---------- */
async function fetchStockDataForReport() {
  // charge données
  const [articlesSnap, stockArticlesSnap, lotsSnap] = await Promise.all([
    getDocs(collection(db, "articles")),
    getDocs(collection(db, "stock_articles")),
    getDocs(collection(db, "lots"))
  ]);

  // maps
  const articles = {};
  articlesSnap.forEach(d => { const data = d.data(); articles[d.id] = data; });

  const stockArticles = {};
  stockArticlesSnap.forEach(d => { stockArticles[d.id] = d.data(); });

  // agréger lots par PLU
  const perPlu = {};
  lotsSnap.forEach(d => {
    const lot = d.data();
    // identifie le PLU
    const plu = lot.plu || lot.PLU || lot.articleId || "UNKNOWN";
    // poids restant (fichiers peuvent utiliser différents noms)
    const poidsRestant = Number(lot.poidsRestant ?? lot.poids ?? lot.remainingQuantity ?? 0);
    if (poidsRestant <= 0) return;
    if (!perPlu[plu]) perPlu[plu] = { kg:0, lots:[], designation: lot.designation || "" };
    perPlu[plu].kg += poidsRestant;
    perPlu[plu].lots.push({
      poidsRestant,
      pma: Number(lot.pma ?? lot.prixAchatKg ?? 0),
      pvTTC: Number(lot.pvTTC ?? lot.pvTTCreel ?? 0),
      dlc: lot.dlc ?? lot.datePeremption ?? lot.DLC ?? null
    });
  });

  // construire lignes finales
  const rows = [];
  for (const plu in perPlu) {
    const art = articles[plu] || {};
    const sa = stockArticles[plu] || stockArticles["PLU_" + plu] || {};

    // GENCODE
    const gencode = art.ean || sa.gencode || sa.gencodeEAN || "";

    // DESIGNATION
    const designation = art.designation || art.label || perPlu[plu].designation || "";

    // STOCK (kg)
    const stockKg = perPlu[plu].kg || 0;

    // PMA
    let pma = Number(sa.pma ?? sa.pmaKg ?? 0);
    if (!pma) {
      const lots = perPlu[plu].lots || [];
      let sumKg = 0, sumCost = 0;
      lots.forEach(l => { sumKg += l.poidsRestant; sumCost += l.poidsRestant * (l.pma || 0); });
      pma = sumKg > 0 ? (sumCost / sumKg) : 0;
    }

    // PVTTC
    let pvttc = Number(sa.pvTTCreel ?? sa.pvTTC ?? sa.pvTTCconseille ?? 0);
    if (!pvttc && perPlu[plu].lots && perPlu[plu].lots.length) {
      pvttc = Number(perPlu[plu].lots[0].pvTTC || 0);
    }

    // REEL = pvTTCreel si dispo
    const reel = Number(sa.pvTTCreel ?? 0);

    // DLC = earliest lot.dlc
    const dlcs = (perPlu[plu].lots || [])
      .map(l => l.dlc)
      .filter(Boolean)
      .map(x => {
        const d = (x && typeof x === "object" && x.toDate) ? x.toDate() : new Date(x);
        return isNaN(d) ? null : d;
      })
      .filter(Boolean);
    const dlc = dlcs.length ? dlcs.sort((a,b)=>a-b)[0].toISOString().slice(0,10) : "";

    rows.push({
      plu,
      gencode,
      designation,
      stockKg: Number(stockKg.toFixed(3)),
      pma: pma ? Number(pma.toFixed(3)) : "",
      pvttc: pvttc ? Number(pvttc.toFixed(2)) : "",
      reel: reel ? Number(reel.toFixed(2)) : "",
      dlc
    });
  }

  // trier par stock descendant
  rows.sort((a,b) => b.stockKg - a.stockKg);
  return rows;
}

function buildPrintHtml(rows, title = "Stock - Rapport") {
  const css = `
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:18px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #ddd;padding:6px;text-align:left;}
      th{background:#f4f4f4;}
      caption{font-size:16px;font-weight:700;margin-bottom:8px;text-align:left;}
      @media print {
        body{margin:0;}
        @page{size: A4 portrait; margin:10mm;}
      }
    </style>
  `;
  const trHtml = rows.map(r => `
    <tr>
      <td>${escapeHtml(String(r.plu))}</td>
      <td>${escapeHtml(String(r.gencode||""))}</td>
      <td>${escapeHtml(String(r.designation||""))}</td>
      <td style="text-align:right">${Number(r.stockKg||0).toFixed(3)}</td>
      <td style="text-align:right">${r.pma !== "" ? Number(r.pma).toFixed(3) : ""}</td>
      <td style="text-align:right">${r.pvttc !== "" ? Number(r.pvttc).toFixed(2) : ""}</td>
      <td style="text-align:right">${r.reel !== "" ? Number(r.reel).toFixed(2) : ""}</td>
      <td style="text-align:center">${r.dlc || ""}</td>
    </tr>`).join("\n");

  const html = `
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${css}</head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <table>
          <caption>PLU / GENCODE / DESIGNATION / STOCK (kg) / PMA / PVTTC / REEL / DLC</caption>
          <thead>
            <tr>
              <th>PLU</th><th>GENCODE</th><th>DESIGNATION</th><th>STOCK (kg)</th><th>PMA</th><th>PVTTC</th><th>REEL</th><th>DLC</th>
            </tr>
          </thead>
          <tbody>${trHtml}</tbody>
        </table>
      </body>
    </html>
  `;
  return html;
}

async function printStockReport() {
  try {
    const rows = await fetchStockDataForReport();
    if (!rows || !rows.length) { alert("Aucun stock trouvé."); return; }
    const html = buildPrintHtml(rows, "Rapport de stock");
    const w = window.open("", "_blank", "toolbar=0,location=0,menubar=0");
    if (!w) { alert("Popup bloquée. Autorise les popups pour imprimer."); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(()=>{ w.focus(); w.print(); }, 600);
  } catch(e) {
    console.error("Erreur printStockReport:", e);
    alert("Erreur lors de la préparation du PDF: " + (e && e.message ? e.message : e));
  }
}

// helper escape
function escapeHtml(s){ if(s==null) return ""; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

// hook bouton si existe
try { document.getElementById('btnPrintStock')?.addEventListener('click', printStockReport); } catch(e){}

window.printStockReport = printStockReport;

/************************************************************
 * 🔟 Lancement
 ************************************************************/
initMarginUI();
loadStock();
