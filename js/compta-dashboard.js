// js/compta-dashboard.js
import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* =========================
   Utils & constantes
   ========================= */
const TVA_RATE = 0.055; // 5.5%

const n2 = v => Number(v || 0).toFixed(2);
function round2(n){ return Math.round((Number(n) + Number.EPSILON)*100)/100; }
function toNum(v){
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).trim().replace(/\s/g,'').replace(',', '.');
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
}
function toDateAny(v){
  if (!v) return null;
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isFinite(d) ? d : null;
}
function ymd(d){
  const x = new Date(d);
  const mm = String(x.getMonth()+1).padStart(2,'0');
  const dd = String(x.getDate()).padStart(2,'0');
  return `${x.getFullYear()}-${mm}-${dd}`;
}

/* =========================
   Date helpers (LOCAL dates)
   ========================= */
function localDateISO(d){
  if (!d || !(d instanceof Date)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function previousDateString(dateISO){
  // dateISO = 'YYYY-MM-DD'
  const [y,m,d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()-1);
  return localDateISO(dt);
}
// normalized header date -> local YYYY-MM-DD
function headerDateToISO(headerDateRaw){
  if (!headerDateRaw) return null;
  if (typeof headerDateRaw === 'object' && typeof headerDateRaw.toDate === 'function') {
    const d = headerDateRaw.toDate();
    return localDateISO(d);
  }
  if (headerDateRaw instanceof Date) return localDateISO(headerDateRaw);
  if (typeof headerDateRaw === 'string') {
    // if starts with YYYY-MM-DD keep that
    const m = headerDateRaw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const parsed = toDateAny(headerDateRaw);
    if (parsed) return localDateISO(parsed);
    return null;
  }
  const parsed = toDateAny(headerDateRaw);
  return parsed ? localDateISO(parsed) : null;
}

/* ISO-week helper -> Monday local */
function isoWeekToDate(isoYear, isoWeek){
  // returns Monday of given iso week in local timezone
  // algorithm: Jan 4th of isoYear is always in week 1
  const jan4 = new Date(isoYear,0,4);
  const dayOfWeek = (jan4.getDay() + 6) % 7; // 0 = Monday
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - dayOfWeek);
  const monday = new Date(firstMonday);
  monday.setDate(firstMonday.getDate() + (isoWeek - 1) * 7);
  monday.setHours(0,0,0,0);
  return monday;
}

/* =========================
   DOM bindings
   ========================= */
const el = {
  modeTabs: document.getElementById("modeTabs"),
  inputsRow: document.getElementById("inputsRow"),
  zCaHT: document.getElementById("zCaHT"),
  zNote: document.getElementById("zNote"),
  btnSaveZ: document.getElementById("btnSaveZ"),
  btnValiderJournee: document.getElementById("btnValiderJournee"),
  btnRecalcJournee: document.getElementById("btnRecalcJournee"),
  btnUnvalidateJournee: document.getElementById("btnUnvalidateJournee"),
  status: document.getElementById("status"),
  sumCaReel: document.getElementById("sumCaReel"),
  sumAchatsConso: document.getElementById("sumAchatsConso"),
  sumVarStock: document.getElementById("sumVarStock"),
  sumMarge: document.getElementById("sumMarge"),
  sumMargePct: document.getElementById("sumMargePct"),
  tdStockDebut: document.getElementById("stockDebut"),
  tdStockFin: document.getElementById("stockFin"),
  tdAchatsPeriode: document.getElementById("achatsPeriode"),
  tdAchatsConso: document.getElementById("achatsConso"),
  tdCaTheo: document.getElementById("caTheo"),
  tdCaReel: document.getElementById("caReel"),
  chartMain: document.getElementById("chartMain")
};

let mode = "day";
let chart = null;

/* =========================
   Render inputs + events
   ========================= */
function refreshHeaderButtons(){
  const dayMode = (mode === "day");
  if (el.btnSaveZ) el.btnSaveZ.style.display = dayMode ? "" : "none";
  if (el.btnValiderJournee) el.btnValiderJournee.style.display = dayMode ? "" : "none";
  if (el.btnRecalcJournee) el.btnRecalcJournee.style.display = dayMode ? "" : "none";
  if (el.btnUnvalidateJournee) el.btnUnvalidateJournee.style.display = dayMode ? "" : "none";
}

function renderInputs(){
  const now = new Date();
  el.inputsRow.innerHTML = "";
  if (mode === "day"){
    el.inputsRow.innerHTML = `<label>Date
      <input id="inpDay" type="date" value="${localDateISO(now)}">
    </label>`;
  } else if (mode === "week"){
    el.inputsRow.innerHTML = `<label>Semaine
      <input id="inpWeek" type="week">
    </label>`;
    const w = (function(d){
      const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayNum = (date.getDay()+6)%7;
      date.setDate(date.getDate()+4-dayNum);
      const yearStart = new Date(Date.UTC(date.getFullYear(),0,1));
      return Math.ceil((((date - yearStart)/86400000)+1)/7);
    })(now);
    const elWeek = document.getElementById("inpWeek");
    if (elWeek) elWeek.value = `${now.getFullYear()}-W${String(w).padStart(2,'0')}`;
  } else if (mode === "month"){
    el.inputsRow.innerHTML = `<label>Mois
      <input id="inpMonth" type="month" value="${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}">
    </label>`;
  } else if (mode === "year"){
    el.inputsRow.innerHTML = `<label>Année
      <input id="inpYear" type="number" min="2020" step="1" value="${now.getFullYear()}">
    </label>`;
  } else { // custom
    el.inputsRow.innerHTML = `<label>Début
      <input id="inpStart" type="date" value="${localDateISO(now)}">
    </label>
    <label>Fin
      <input id="inpEnd" type="date" value="${localDateISO(now)}">
    </label>`;
  }

  el.inputsRow.querySelectorAll("input").forEach(i => {
    i.addEventListener("change", () => { refreshDashboard(); });
  });

  refreshHeaderButtons();
}

function getSelectedRange(){
  const now = new Date();
  if (mode === "day"){
    const v = document.getElementById("inpDay")?.value || localDateISO(now);
    const [Y,M,D] = v.split('-').map(Number);
    const start = new Date(Y, M-1, D); start.setHours(0,0,0,0);
    const end = new Date(Y, M-1, D); end.setHours(23,59,59,999);
    return { start, end };
  }
  if (mode === "week"){
    const v = document.getElementById("inpWeek")?.value;
    if (v){
      const [y, wStr] = v.split("-W"); const w = Number(wStr);
      const monday = isoWeekToDate(Number(y), w);
      const start = new Date(monday); start.setHours(0,0,0,0);
      const end = new Date(monday); end.setDate(monday.getDate()+6); end.setHours(23,59,59,999);
      return { start, end };
    }
    return { start: now, end: now };
  }
  if (mode === "month"){
    const v = document.getElementById("inpMonth")?.value;
    const [Y,M] = v ? v.split('-').map(Number) : [now.getFullYear(), now.getMonth()+1];
    const start = new Date(Y, M-1, 1); start.setHours(0,0,0,0);
    const end = new Date(Y, M, 0); end.setHours(23,59,59,999);
    return { start, end };
  }
  if (mode === "year"){
    const y = Number(document.getElementById("inpYear")?.value || now.getFullYear());
    const start = new Date(y,0,1); start.setHours(0,0,0,0);
    const end = new Date(y,11,31); end.setHours(23,59,59,999);
    return { start, end };
  }
  // custom
  const s = document.getElementById("inpStart")?.value || localDateISO(now);
  const e = document.getElementById("inpEnd")?.value || localDateISO(now);
  const [Ys,Ms,Ds] = s.split('-').map(Number);
  const [Ye,Me,De] = e.split('-').map(Number);
  const start = new Date(Ys, Ms-1, Ds); start.setHours(0,0,0,0);
  const end = new Date(Ye, Me-1, De); end.setHours(23,59,59,999);
  return { start, end };
}

/* =========================
   Purchases robustes + debug
   ========================= */
// ... keep the getPurchasesForRange, debugListPurchasesForDate, inspectPurchases as before
// (Assume they are present as in your current file) 

/* =========================
   Inventory read and normalization
   ========================= */
/* getInventoryForDate and mapChangesByPlu kept as in your file */
async function getInventoryForDate(dateISO){
  try{
    const ref = doc(db, "journal_inventaires", dateISO);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!Array.isArray(data.changes)) {
      if (Array.isArray(data.items)) data.changes = data.items;
      else data.changes = [];
    }
    data.changes = data.changes.map(c => ({
      plu: String(c.plu || c.PLU || c.pluCode || c.code || (c.article && c.article.plu) || "").trim(),
      counted: (c.counted !== undefined ? c.counted : (c.countedKg !== undefined ? c.countedKg : (c.stock_reel !== undefined ? c.stock_reel : 0))),
      prevStock: (c.prevStock !== undefined ? c.prevStock : (c.prev_stock !== undefined ? c.prev_stock : null)),
      ...c
    }));
    return data;
  }catch(e){
    console.warn("getInventoryForDate err", e);
    return null;
  }
}
function mapChangesByPlu(changesArray){
  const map = {};
  if (!Array.isArray(changesArray)) return map;
  changesArray.forEach(c => {
    if (!c) return;
    const plu = String(c.plu || c.PLU || c.pluCode || c.code || (c.article && c.article.plu) || "").trim();
    if (!plu) return;
    const counted = (c.counted !== undefined && c.counted !== null) ? c.counted
                  : (c.countedKg !== undefined && c.countedKg !== null) ? c.countedKg
                  : (c.stock_reel !== undefined && c.stock_reel !== null) ? c.stock_reel
                  : 0;
    const prevStock = (c.prevStock !== undefined && c.prevStock !== null) ? c.prevStock
                    : (c.prev_stock !== undefined && c.prev_stock !== null) ? c.prev_stock
                    : null;
    map[plu] = Object.assign({}, c, { plu, counted, prevStock });
  });
  return map;
}

/* =========================
   Read prices from stock_movements (pma, salePriceTTC)
   ========================= */
async function getPricesForPluSet(pluSet, dateISO){
  const dateT = new Date(dateISO + "T23:59:59");
  const result = {};
  pluSet.forEach(p => result[p] = { buyPrice: null, buyTs: 0, salePriceTTC: null, saleTs: 0, salePriceHT: null });
  try{
    const snap = await getDocs(collection(db, "stock_movements"));
    snap.forEach(ds => {
      const m = ds.data();
      const plu = String(m.plu || m.PLU || "");
      if (!plu || !pluSet.has(plu)) return;
      if (!m.createdAt || typeof m.createdAt.toDate !== 'function') return;
      const created = m.createdAt.toDate();
      if (created > dateT) return;
      const ts = created.getTime();
      const buyCandidate = toNum(m.pma ?? m.prixAchatKg ?? m.prixAchat ?? 0);
      if (buyCandidate > 0 && ts >= (result[plu].buyTs || 0)) {
        result[plu].buyPrice = buyCandidate;
        result[plu].buyTs = ts;
      }
      const saleCandidate = toNum(m.salePriceTTC ?? 0);
      if (saleCandidate > 0 && ts >= (result[plu].saleTs || 0)) {
        result[plu].salePriceTTC = saleCandidate;
        result[plu].saleTs = ts;
      }
    });
  }catch(e){
    console.warn("getPricesForPluSet err", e);
  }
  for (const p of Object.keys(result)){
    if (result[p].salePriceTTC) result[p].salePriceHT = round2(result[p].salePriceTTC / (1 + TVA_RATE));
    else result[p].salePriceHT = null;
  }
  return result;
}

/* =========================
   NEW: computeStockValueForDate
   ========================= */
/**
 * computeStockValueForDate(dateISO)
 * - dateISO : 'YYYY-MM-DD' (local)
 * Retour :
 * {
 *   totalValue: number,
 *   perPlu: { [plu]: { counted: number, buyPrice: number|null, value: number } },
 *   missingPrices: [plu,...]
 * }
 */
async function computeStockValueForDate(dateISO) {
  // 1) lire l'inventaire du jour
  const inv = await getInventoryForDate(dateISO);
  const changes = inv?.changes || [];
  const perPluCounted = {}; // plu -> counted
  changes.forEach(c => {
    const plu = String(c.plu || c.PLU || c.pluCode || c.code || (c.article && c.article.plu) || "").trim();
    if (!plu) return;
    const counted = Number(c.counted ?? c.countedKg ?? 0) || 0;
    perPluCounted[plu] = (perPluCounted[plu] || 0) + counted;
  });

  const pluList = Object.keys(perPluCounted);
  if (pluList.length === 0) return { totalValue: 0, perPlu: {}, missingPrices: [] };

  // 2) récupérer stock_movements et garder, par PLU, le dernier pma <= dateT
  const dateT = new Date(dateISO + "T23:59:59");
  const snapMov = await getDocs(collection(db, "stock_movements"));
  const priceByPlu = {}; // plu -> { buyPrice, ts }
  snapMov.forEach(docSnap => {
    const m = docSnap.data();
    const plu = String(m.plu || m.PLU || "");
    if (!plu) return;
    if (!m.createdAt || typeof m.createdAt.toDate !== "function") return;
    const created = m.createdAt.toDate();
    if (created > dateT) return;
    const ts = created.getTime();
    const buyCandidate = toNum(m.pma ?? m.prixAchatKg ?? m.prixAchat ?? 0);
    if (buyCandidate > 0) {
      if (!priceByPlu[plu] || ts >= priceByPlu[plu].ts) {
        priceByPlu[plu] = { buyPrice: buyCandidate, ts };
      }
    }
  });

  // 3) fallback: lots (si présent)
  try {
    const snapLots = await getDocs(collection(db, "lots"));
    const lotsByPlu = {};
    snapLots.forEach(d => {
      const l = d.data();
      const plu = String(l.plu || l.PLU || l.articleId || d.id || "").trim();
      if (!plu) return;
      // pick a lot prixAchatKg if present (not focusing on timestamps here)
      if (!lotsByPlu[plu]) lotsByPlu[plu] = [];
      lotsByPlu[plu].push(l);
    });
    for (const p of pluList) {
      if (!priceByPlu[p]) {
        const lots = lotsByPlu[p] || [];
        // choose first lot with prixAchatKg > 0
        let chosen = null;
        for (const l of lots) {
          const v = toNum(l.prixAchatKg ?? l.prixAchat ?? 0);
          if (v > 0) { chosen = v; break; }
        }
        if (chosen) priceByPlu[p] = { buyPrice: chosen, ts: 0 };
      }
    }
  } catch (e) {
    // ignore fallback errors
    console.warn("computeStockValueForDate: lots fallback failed", e);
  }

  // 4) compose perPlu values
  const perPlu = {};
  let totalValue = 0;
  const missingPrices = [];
  for (const plu of pluList) {
    const counted = Number(perPluCounted[plu] || 0);
    const priceEntry = priceByPlu[plu];
    const buyPrice = priceEntry ? Number(priceEntry.buyPrice || 0) : null;
    const val = buyPrice ? round2(counted * buyPrice) : 0;
    perPlu[plu] = { counted, buyPrice: buyPrice ?? null, value: val };
    totalValue += val;
    if (!buyPrice) missingPrices.push(plu);
  }
  totalValue = round2(totalValue);
  return { totalValue, perPlu, missingPrices };
}

/* =========================
   Core computePeriodCompta
   ========================= */
async function computePeriodCompta(fromISO, toISO){
  // achats
  let achatsPeriode = 0;
  try { achatsPeriode = await getPurchasesForRange(fromISO, toISO); } catch(e){ achatsPeriode = 0; console.warn(e); }

  // stocks: use new computeStockValueForDate
  const prevISO = previousDateString(fromISO);
  let stockDebutValue = 0;
  let stockFinValue = 0;
  let stockDebutDetails = null;
  let stockFinDetails = null;
  try {
    const sDeb = await computeStockValueForDate(prevISO);
    stockDebutValue = sDeb.totalValue;
    stockDebutDetails = sDeb;
  } catch(e) {
    console.warn("computePeriodCompta: stockDebut compute failed", e);
    stockDebutValue = 0;
  }
  try {
    const sFin = await computeStockValueForDate(toISO);
    stockFinValue = sFin.totalValue;
    stockFinDetails = sFin;
  } catch(e) {
    console.warn("computePeriodCompta: stockFin compute failed", e);
    stockFinValue = 0;
  }

  // build PLU set from inventory for caTheorique (reuse old logic)
  const invPrev = await getInventoryForDate(prevISO);
  const invToday = await getInventoryForDate(toISO);
  const mapPrev = mapChangesByPlu(invPrev?.changes || []);
  const mapToday = mapChangesByPlu(invToday?.changes || []);
  const pluSet = new Set([...Object.keys(mapPrev), ...Object.keys(mapToday)]);

  // retrieve sale prices for caTheorique
  const pricesToday = await getPricesForPluSet(pluSet, toISO);

  // ca theorique using counted differences and salePriceHT (or buyPrice as fallback)
  let caTheorique = 0;
  for (const plu of pluSet) {
    const prevCount = mapPrev[plu] ? toNum(mapPrev[plu].counted || mapPrev[plu].countedKg || 0) : 0;
    const todayCount = mapToday[plu] ? toNum(mapToday[plu].counted || mapToday[plu].countedKg || 0) : 0;
    const poidsVendu = Math.max(0, prevCount - todayCount);
    const salePriceHT = (pricesToday[plu] && pricesToday[plu].salePriceHT) ? pricesToday[plu].salePriceHT
      : (pricesToday[plu] && pricesToday[plu].buyPrice) ? pricesToday[plu].buyPrice
      : 0;
    caTheorique += poidsVendu * salePriceHT;
  }
  caTheorique = round2(caTheorique);

  const achatsConsomesFormula = round2(stockDebutValue + achatsPeriode - stockFinValue);

  // ca reel
  let caReel = 0;
  try {
    const q = query(collection(db, "compta_journal"), where("date", ">=", fromISO), where("date", "<=", toISO));
    const snap = await getDocs(q);
    snap.forEach(d => { caReel += toNum(d.data().caReel || d.data().caHT || 0); });
    caReel = round2(caReel);
  } catch(e) { console.warn(e); }

  const marge = round2(caReel - achatsConsomesFormula);
  const margePct = caReel ? round2((marge / caReel) * 100) : 0;

  return {
    stockDebut: stockDebutValue,
    stockFin: stockFinValue,
    achatsPeriode,
    achatsConsomesFormula,
    caTheorique,
    caReel,
    marge,
    margePct,
    pricesUsed: { today: pricesToday },
    stockDetails: { prev: stockDebutDetails, today: stockFinDetails }
  };
}

/* =========================
   UI rendering and actions
   ========================= */
function renderChart(items){
  if (!el.chartMain) return;
  const labels = items.map(i => i.label);
  const data = items.map(i => i.value);
  if (chart) chart.destroy();
  chart = new Chart(el.chartMain.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Montants €', data, backgroundColor: ['#2b9dff','#4a4a4a','#ff9d00'] }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

async function refreshDashboard(){
  try{
    if (el.status) el.status.textContent = "Chargement…";
    const range = getSelectedRange();
    const fromISO = localDateISO(range.start);
    const toISO = localDateISO(range.end);
    const res = await computePeriodCompta(fromISO, toISO);

    if (el.tdStockDebut) el.tdStockDebut.textContent = `${n2(res.stockDebut)} €`;
    if (el.tdStockFin) el.tdStockFin.textContent = `${n2(res.stockFin)} €`;
    if (el.tdAchatsPeriode) el.tdAchatsPeriode.textContent = `${n2(res.achatsPeriode)} €`;
    if (el.tdAchatsConso) el.tdAchatsConso.textContent = `${n2(res.achatsConsomesFormula)} €`;
    if (el.tdCaTheo) el.tdCaTheo.textContent = `${n2(res.caTheorique)} €`;
    if (el.tdCaReel) el.tdCaReel.textContent = `${n2(res.caReel)} €`;

    if (el.sumCaReel) el.sumCaReel.textContent = n2(res.caReel);
    if (el.sumAchatsConso) el.sumAchatsConso.textContent = n2(res.achatsConsomesFormula);
    const varStock = round2(res.stockDebut - res.stockFin);
    if (el.sumVarStock) el.sumVarStock.textContent = n2(varStock);
    if (el.sumMarge) el.sumMarge.textContent = n2(res.marge);
    if (el.sumMargePct) el.sumMargePct.textContent = (round2(res.margePct) || 0).toFixed(1);

    renderChart([
      { label: "CA réel HT", value: res.caReel },
      { label: "Achats consommés HT", value: res.achatsConsomesFormula },
      { label: "Variation stock HT", value: varStock }
    ]);

    if (el.status) el.status.textContent = "";

    // debug / warning missing prices
    const missing = (res.stockDetails && (res.stockDetails.prev?.missingPrices || res.stockDetails.today?.missingPrices)) || [];
    if (missing && missing.length) {
      if (el.status) el.status.textContent = `⚠ ${missing.length} PLU(s) sans prix d'achat détecté (fallback à 0). Voir console.`;
      console.log("stockDetails:", res.stockDetails);
    }

  }catch(e){
    console.error(e);
    if (el.status) el.status.textContent = "Erreur : " + (e.message || e);
  }
}

/* Z save / validate */
async function saveZForDay(dateISO){
  const zht = toNum(el.zCaHT?.value || 0);
  const note = (el.zNote?.value || "").trim();
  await setDoc(doc(db, "compta_journal", dateISO), {
    date: dateISO, caReel: zht, zNote: note, validated:false, updatedAt: serverTimestamp()
  }, { merge:true });
  if (el.status) el.status.textContent = `Z enregistré pour ${dateISO}`;
  refreshDashboard();
}

async function validerJournee(dateISO){
  const calc = await computePeriodCompta(dateISO, dateISO);
  const zFromField = toNum(el.zCaHT?.value || 0);
  let caReel = calc.caReel;
  if (zFromField > 0) caReel = zFromField;
  const payload = {
    date: dateISO,
    stockDebut: calc.stockDebut,
    stockFin: calc.stockFin,
    achatsPeriode: calc.achatsPeriode,
    achatsConsoFinal: calc.achatsConsomesFormula,
    caTheorique: calc.caTheorique,
    caReel,
    marge: round2(caReel - calc.achatsConsomesFormula),
    margePct: (caReel ? round2((caReel - calc.achatsConsomesFormula)/caReel*100) : 0),
    validated: true, validatedAt: serverTimestamp(), zNote: (el.zNote?.value || "").trim()
  };
  await setDoc(doc(db, "compta_journal", dateISO), payload, { merge:true });
  if (el.status) el.status.textContent = `Journée ${dateISO} validée.`;
  refreshDashboard();
}

async function unvalidateJournee(dateISO){
  const ref = doc(db, "compta_journal", dateISO);
  const snap = await getDoc(ref);
  if (!snap.exists()) { if (el.status) el.status.textContent = "Aucune validation trouvée."; return; }
  await updateDoc(ref, { validated:false, validatedAt: serverTimestamp() });
  if (el.status) el.status.textContent = `Validation supprimée pour ${dateISO}.`;
  refreshDashboard();
}

/* =========================
   Events wiring
   ========================= */
function wireEvents(){
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      mode = e.currentTarget.dataset.mode;
      renderInputs();
      refreshDashboard();
    });
  });

  if (el.btnSaveZ) el.btnSaveZ.addEventListener("click", async () => {
    const day = document.getElementById("inpDay")?.value;
    if (!day) return alert("Choisis une date.");
    await saveZForDay(day);
  });

  if (el.btnValiderJournee) el.btnValiderJournee.addEventListener("click", async () => {
    const day = document.getElementById("inpDay")?.value;
    if (!day) return alert("Choisis une date.");
    if (!confirm(`Valider la journée ${day} (figer la marge) ?`)) return;
    await validerJournee(day);
  });

  if (el.btnRecalcJournee) el.btnRecalcJournee.addEventListener("click", async () => {
    await refreshDashboard();
    if (el.status) el.status.textContent = "Recalcul effectué — tu peux modifier le Z avant validation.";
  });

  if (el.btnUnvalidateJournee) el.btnUnvalidateJournee.addEventListener("click", async () => {
    const day = document.getElementById("inpDay")?.value;
    if (!day) return alert("Choisis une date.");
    if (!confirm(`Supprimer la validation de ${day} ?`)) return;
    await unvalidateJournee(day);
  });
}

/* =========================
   Init
   ========================= */
async function initDashboard(){
  auth.onAuthStateChanged(async user => {
    try{
      if (!user) { if (el.status) el.status.textContent = "Connecte-toi pour voir le module Comptabilité."; return; }
      const snap = await getDoc(doc(db,'app_users',user.uid));
      if (!snap.exists()) { if (el.status) el.status.textContent = "Accès refusé."; return; }
      const d = snap.data();
      const ok = (d.role === 'admin') || (Array.isArray(d.modules) && d.modules.includes('compta'));
      if (!ok) { if (el.status) el.status.textContent = "Accès refusé au module Comptabilité."; return; }
      wireEvents();
      renderInputs();
      refreshDashboard();
    }catch(e){
      console.error(e);
      if (el.status) el.status.textContent = "Erreur d'initialisation : "+(e.message||e);
    }
  });
}

initDashboard();
