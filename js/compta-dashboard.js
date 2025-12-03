// js/compta-dashboard.js
import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* =========================
   Utils & Constantes
   ========================= */
const n2 = v => Number(v || 0).toFixed(2);
function toNum(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
}
function toDateAny(v) {
  if (!v) return null;
  if (v && typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  // Accept parseable strings
  const d = new Date(v);
  return isFinite(d) ? d : null;
}
function ymd(d) {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

/* TVA 5.5% pour conversion salePriceTTC -> HT */
const TVA_RATE = 0.055;

/* =========================
   Date helpers / ranges
   ========================= */
function previousDateString(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0,10);
}

function localDateISO(d) {
  if (!d || !(d instanceof Date)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Normalize header date to 'YYYY-MM-DD' using LOCAL date */
function headerDateToISO(headerDateRaw) {
  if (!headerDateRaw) return null;

  // Firestore Timestamp
  if (typeof headerDateRaw === 'object' && typeof headerDateRaw.toDate === 'function') {
    const d = headerDateRaw.toDate();
    return localDateISO(d);
  }

  // Date object
  if (headerDateRaw instanceof Date) return localDateISO(headerDateRaw);

  // String 'YYYY-MM-DD' or other
  if (typeof headerDateRaw === 'string') {
    // If it starts with YYYY-MM-DD, keep it exactly (no timezone shift)
    const m = headerDateRaw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // fallback parse -> then use local date
    const parsed = toDateAny(headerDateRaw);
    if (parsed) return localDateISO(parsed);
    return null;
  }

  // Generic fallback: try to parse
  const parsed = toDateAny(headerDateRaw);
  return parsed ? localDateISO(parsed) : null;
}

function getISOWeekRange(date){
  const d = new Date(date);
  const day = (d.getDay()+6)%7; // 0=lundi
  const start = new Date(d); start.setDate(d.getDate()-day); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
  return { start, end };
}
function getMonthRange(date){
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1); start.setHours(0,0,0,0);
  const end = new Date(d.getFullYear(), d.getMonth()+1, 0); end.setHours(23,59,59,999);
  return { start, end };
}
function getYearRange(year){
  const start = new Date(year,0,1); start.setHours(0,0,0,0);
  const end = new Date(year,11,31); end.setHours(23,59,59,999);
  return { start, end };
}
function getISOWeekNumber(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}

/* =========================
   DOM bindings
   ========================= */
const tabs = document.getElementById("modeTabs");
const inputsRow = document.getElementById("inputsRow");

const el = {
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

  chartMain: document.getElementById("chartMain"),
};

let mode = "day";
let chart = null;
let editingDay = false;
let savedDayData = null;

/* =========================
   Render inputs by mode
   ========================= */
function renderInputs(){
  inputsRow.innerHTML = "";
  const now = new Date();

  if (mode === "day") {
    inputsRow.innerHTML = `<label>Date
      <input id="inpDay" type="date" value="${ymd(now)}">
    </label>`;
  } else if (mode === "week") {
    inputsRow.innerHTML = `<label>Semaine
      <input id="inpWeek" type="week">
    </label>`;
    const w = getISOWeekNumber(now);
    const elWeek = document.getElementById("inpWeek");
    if (elWeek) elWeek.value = `${now.getFullYear()}-W${String(w).padStart(2,"0")}`;
  } else if (mode === "month") {
    inputsRow.innerHTML = `<label>Mois
      <input id="inpMonth" type="month" value="${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}">
    </label>`;
  } else if (mode === "year") {
    inputsRow.innerHTML = `<label>Année
      <input id="inpYear" type="number" min="2020" step="1" value="${now.getFullYear()}">
    </label>`;
  } else if (mode === "custom") {
    inputsRow.innerHTML = `<label>Début
      <input id="inpStart" type="date" value="${ymd(now)}">
    </label>
    <label>Fin
      <input id="inpEnd" type="date" value="${ymd(now)}">
    </label>`;
  }

  inputsRow.querySelectorAll("input").forEach(i => {
    i.addEventListener("change", () => {
      editingDay = false; savedDayData = null;
      refreshDashboard();
    });
  });

  refreshHeaderButtons();
}

function refreshHeaderButtons(){
  const dayMode = (mode === "day");
  if (el.btnSaveZ) el.btnSaveZ.style.display = dayMode ? "" : "none";
  if (el.btnValiderJournee) el.btnValiderJournee.style.display = dayMode ? "" : "none";
  if (el.btnRecalcJournee) el.btnRecalcJournee.style.display = dayMode ? "" : "none";
  if (el.btnUnvalidateJournee) el.btnUnvalidateJournee.style.display = dayMode ? "" : "none";
}

/* =========================
   Range selection
   ========================= */
function getSelectedRange(){
  const now = new Date();
  if (mode === "day") {
    const v = document.getElementById("inpDay")?.value || ymd(now);
    const d = new Date(v);
    const start = new Date(d); start.setHours(0,0,0,0);
    const end = new Date(d); end.setHours(23,59,59,999);
    return { start, end };
  }
  if (mode === "week") {
    const v = document.getElementById("inpWeek")?.value;
    if (v) {
      const [y, wStr] = v.split("-W"); const w = Number(wStr);
      const firstThurs = new Date(Number(y), 0, 1 + (w - 1) * 7);
      return getISOWeekRange(firstThurs);
    }
    return getISOWeekRange(now);
  }
  if (mode === "month") {
    const v = document.getElementById("inpMonth")?.value;
    const d = v ? new Date(v + "-01") : now;
    return getMonthRange(d);
  }
  if (mode === "year") {
    const y = Number(document.getElementById("inpYear")?.value || now.getFullYear());
    return getYearRange(y);
  }
  if (mode === "custom") {
    const s = document.getElementById("inpStart")?.value || ymd(now);
    const e = document.getElementById("inpEnd")?.value || ymd(now);
    const start = new Date(s); start.setHours(0,0,0,0);
    const end = new Date(e); end.setHours(23,59,59,999);
    return { start, end };
  }
  return { start: now, end: now };
}

/* =========================
   Data loaders (generic)
   ========================= */
async function loadInventaires() {
  const snap = await getDocs(collection(db, "journal_inventaires"));
  const invs = [];
  snap.forEach(d => {
    const r = d.data();
    const dateStr = r.date || d.id;
    const dt = toDateAny(dateStr) || new Date(dateStr);
    if (isFinite(dt)) invs.push({ dateStr, date: dt, valeur: toNum(r.valeurStockHT || 0), raw: r });
  });
  invs.sort((a,b) => a.date - b.date);
  return invs;
}

/* =========================
   Purchases helpers (strict: header date + montantHT)
   ========================= */
async function getPurchasesForRange(fromISO, toISO) {
  try {
    const snap = await getDocs(collection(db, "achats"));
    const included = [];
    let total = 0;

    snap.forEach(docSnap => {
      const r = docSnap.data();
      const headerRaw = (r.date !== undefined && r.date !== null) ? r.date
                    : (r.dateAchat !== undefined && r.dateAchat !== null) ? r.dateAchat
                    : null;
      if (!headerRaw) return;

      const headerISO = headerDateToISO(headerRaw); // local YYYY-MM-DD
      if (!headerISO) return;

      if (headerISO >= fromISO && headerISO <= toISO) {
        const montant = toNum(r.montantHT || r.totalHT || r.montant || 0);
        total += montant;
        included.push({
          id: docSnap.id,
          headerRaw,
          headerISO,
          montantHT: round2(montant)
        });
      }
    });

    console.debug(`getPurchasesForRange ${fromISO}..${toISO} → ${included.length} achats (total ${round2(total)} €)`);
    if (included.length) console.table(included);

    return round2(total);
  } catch (err) {
    console.error("getPurchasesForRange error:", err);
    return 0;
  }
}
async function getPurchasesForDate(dateISO) {
  return await getPurchasesForRange(dateISO, dateISO);
}
async function debugListPurchasesForDate(dateISO) {
  try {
    const snap = await getDocs(collection(db, "achats"));
    const out = [];
    snap.forEach(docSnap => {
      const r = docSnap.data();
      const headerRaw = (r.date !== undefined && r.date !== null) ? r.date
                      : (r.dateAchat !== undefined && r.dateAchat !== null) ? r.dateAchat
                      : null;
      const headerISO = headerDateToISO(headerRaw);
      const montant = round2(toNum(r.montantHT || r.totalHT || r.montant || 0));
      if (headerISO === dateISO) {
        out.push({
          id: docSnap.id,
          headerRaw,
          headerISO,
          type: r.type || null,
          statut: r.statut || null,
          montantHT: montant
        });
      }
    });
    console.table(out);
    const sum = out.reduce((s,x)=> s + toNum(x.montantHT), 0);
    console.log("DEBUG sum:", round2(sum));
    return out;
  } catch (e) {
    console.error("debugListPurchasesForDate err:", e);
    return [];
  }
}

/* =========================
   Inventory helper
   ========================= */
async function getInventoryForDate(dateISO) {
  try {
    const ref = doc(db, "journal_inventaires", dateISO);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();

    if (!Array.isArray(data.changes)) {
      if (Array.isArray(data.items)) data.changes = data.items;
      else data.changes = [];
    }

    data.changes = data.changes.map(c => {
      return {
        plu: (c.plu || c.PLU || c.pluCode || c.code || (c.article && c.article.plu) || "").toString(),
        counted: (c.counted !== undefined ? c.counted : (c.countedKg !== undefined ? c.countedKg : (c.stock_reel !== undefined ? c.stock_reel : 0))),
        prevStock: (c.prevStock !== undefined ? c.prevStock : (c.prev_stock !== undefined ? c.prev_stock : null)),
        ...c
      };
    });

    return data;
  } catch (e) {
    console.warn("getInventoryForDate err", e);
    return null;
  }
}

/* =========================
   Map changes -> PLU
   ========================= */
function mapChangesByPlu(changesArray) {
  const map = {};
  if (!Array.isArray(changesArray)) return map;

  changesArray.forEach(c => {
    if (!c) return;
    const plu = String(c.plu || c.PLU || c.pluCode || c.code || (c.article && c.article.plu) || "").trim();
    if (!plu) return;
    const counted =
      (c.counted !== undefined && c.counted !== null) ? c.counted
      : (c.countedKg !== undefined && c.countedKg !== null) ? c.countedKg
      : (c.stock_reel !== undefined && c.stock_reel !== null) ? c.stock_reel
      : 0;
    const prevStock =
      (c.prevStock !== undefined && c.prevStock !== null) ? c.prevStock
      : (c.prev_stock !== undefined && c.prev_stock !== null) ? c.prev_stock
      : null;

    map[plu] = Object.assign({}, c, { plu, counted, prevStock });
  });

  return map;
}

/* =========================
   Prices helper (pma & salePriceTTC)
   ========================= */
async function getPricesForPluSet(pluSet, dateISO) {
  const dateT = new Date(dateISO + "T23:59:59");
  const result = {};
  pluSet.forEach(p => result[p] = { buyPrice: null, buyTs: 0, salePriceTTC: null, saleTs: 0, salePriceHT: null });

  try {
    const snap = await getDocs(collection(db, "stock_movements"));
    snap.forEach(d => {
      const m = d.data();
      const plu = String(m.plu || m.PLU || "");
      if (!plu || !pluSet.has(plu)) return;
      if (!m.createdAt || typeof m.createdAt.toDate !== "function") return;
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
  } catch (e) {
    console.warn("getPricesForPluSet err", e);
  }

  for (const p of Object.keys(result)) {
    if (result[p].salePriceTTC) result[p].salePriceHT = round2(result[p].salePriceTTC / (1 + TVA_RATE));
    else result[p].salePriceHT = null;
  }
  return result;
}

/* =========================
   computePeriodCompta (méthode métier)
   ========================= */
async function computePeriodCompta(fromISO, toISO) {
  // 1) Achats total période
  let achatsPeriode = 0;
  try {
    achatsPeriode = await getPurchasesForRange(fromISO, toISO);
  } catch (e) {
    console.warn("computePeriodCompta -> achatsPeriode err", e);
    achatsPeriode = 0;
  }

  // 2) Inventaires : prev day (stock début) et toISO (stock fin)
  const prevISO = previousDateString(fromISO);
  const invPrev = await getInventoryForDate(prevISO);
  const invToday = await getInventoryForDate(toISO);
  const mapPrev = mapChangesByPlu(invPrev?.changes || []);
  const mapToday = mapChangesByPlu(invToday?.changes || []);

  // union PLU set
  const pluSet = new Set([...Object.keys(mapPrev), ...Object.keys(mapToday)]);

  // 3) récupérer prix
  const pricesPrev = await getPricesForPluSet(pluSet, prevISO);
  const pricesToday = await getPricesForPluSet(pluSet, toISO);

  // 4) valeur stock debut & fin (counted * buyPrice)
  let stockDebutValue = 0;
  let stockFinValue = 0;
  for (const plu of pluSet) {
    const prevEntry = mapPrev[plu];
    const todayEntry = mapToday[plu];

    const prevCount = prevEntry ? toNum(prevEntry.counted || prevEntry.countedKg || 0) : 0;
    const todayCount = todayEntry ? toNum(todayEntry.counted || todayEntry.countedKg || 0) : 0;

    const buyPrev = (pricesPrev[plu] && pricesPrev[plu].buyPrice) ? pricesPrev[plu].buyPrice : 0;
    const buyToday = (pricesToday[plu] && pricesToday[plu].buyPrice) ? pricesToday[plu].buyPrice : buyPrev || 0;

    stockDebutValue += prevCount * buyPrev;
    stockFinValue += todayCount * buyToday;
  }
  stockDebutValue = round2(stockDebutValue);
  stockFinValue = round2(stockFinValue);

  // 5) vente théorique
  let caTheorique = 0;
  for (const plu of pluSet) {
    const prevEntry = mapPrev[plu];
    const todayEntry = mapToday[plu];
    let prevCount = prevEntry ? toNum(prevEntry.counted || prevEntry.countedKg || 0) : 0;
    let todayCount = todayEntry ? toNum(todayEntry.counted || todayEntry.countedKg || 0) : 0;
    let poidsVendu = Math.max(0, prevCount - todayCount);

    const salePriceHT = (pricesToday[plu] && pricesToday[plu].salePriceHT) ? pricesToday[plu].salePriceHT
                          : (pricesToday[plu] && pricesToday[plu].buyPrice) ? pricesToday[plu].buyPrice
                          : 0;
    caTheorique += poidsVendu * salePriceHT;
  }
  caTheorique = round2(caTheorique);

  // 6) achats consommés via ta règle métier
  const achatsConsomesFormula = round2(stockDebutValue + achatsPeriode - stockFinValue);

  // 7) CA réel from compta_journal (range)
  let caReel = 0;
  try {
    const q = query(collection(db, "compta_journal"), where("date", ">=", fromISO), where("date", "<=", toISO));
    const snap = await getDocs(q);
    snap.forEach(d => {
      caReel += toNum(d.data().caReel || d.data().caHT || 0);
    });
    caReel = round2(caReel);
  } catch (e) {
    console.warn("computePeriodCompta -> caReel err", e);
  }

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
    pricesUsed: { prev: pricesPrev, today: pricesToday }
  };
}

/* =========================
   UI: render dashboard
   ========================= */
async function refreshDashboard() {
  try {
    if (!el.status) return;
    el.status.textContent = "Chargement…";
    const range = getSelectedRange();
    const fromISO = range.start.toISOString().slice(0,10);
    const toISO = range.end.toISOString().slice(0,10);

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

    el.status.textContent = "";
    const pricesToday = res.pricesUsed && res.pricesUsed.today ? res.pricesUsed.today : {};
    const missing = Object.keys(pricesToday).filter(p => !pricesToday[p].buyPrice);
    if (missing.length) {
      el.status.textContent = `⚠ ${missing.length} PLU(s) sans prix d'achat détecté (fallback à 0). Voir console pour 'pricesUsed'.`;
      console.log("pricesUsed:", res.pricesUsed);
    }

  } catch (e) {
    console.error(e);
    if (el.status) el.status.textContent = "Erreur lors du calcul : " + (e.message || e);
  }
}

function renderChart(items) {
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

/* =========================
   Z & validation
   ========================= */
async function saveZForDay(dateISO) {
  const zht = toNum(el.zCaHT?.value || 0);
  const note = (el.zNote?.value || "").trim();
  const docRef = doc(db, "compta_journal", dateISO);
  await setDoc(docRef, {
    date: dateISO,
    caReel: zht,
    zNote: note,
    validated: false,
    updatedAt: serverTimestamp()
  }, { merge: true });
  if (el.status) el.status.textContent = `Z enregistré pour ${dateISO}`;
  refreshDashboard();
}

async function validerJournee(dateISO) {
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
    margePct: (caReel ? round2((caReel - calc.achatsConsomesFormula) / caReel * 100) : 0),
    validated: true,
    validatedAt: serverTimestamp(),
    zNote: (el.zNote?.value || "").trim()
  };
  await setDoc(doc(db, "compta_journal", dateISO), payload, { merge: true });
  if (el.status) el.status.textContent = `Journée ${dateISO} validée.`;
  refreshDashboard();
}

async function unvalidateJournee(dateISO) {
  const ref = doc(db, "compta_journal", dateISO);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    if (el.status) el.status.textContent = "Aucune validation trouvée pour cette date.";
    return;
  }
  await updateDoc(ref, { validated: false, validatedAt: serverTimestamp() });
  if (el.status) el.status.textContent = `Validation supprimée pour ${dateISO}.`;
  refreshDashboard();
}

/* =========================
   Events wiring
   ========================= */
function wireEvents() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
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
    editingDay = true;
    savedDayData = null;
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
async function initDashboard() {
  auth.onAuthStateChanged(async user => {
    try {
      if (!user) {
        if (el.status) el.status.textContent = "Connecte-toi pour voir le module Comptabilité.";
        return;
      }
      const snap = await getDoc(doc(db, 'app_users', user.uid));
      if (!snap.exists()) { if (el.status) el.status.textContent = "Accès refusé."; return; }
      const d = snap.data();
      const ok = (d.role === 'admin') || (Array.isArray(d.modules) && d.modules.includes('compta'));
      if (!ok) { if (el.status) el.status.textContent = "Accès refusé au module Comptabilité."; return; }

      wireEvents();
      renderInputs();
      refreshDashboard();
    } catch (e) {
      console.error(e);
      if (el.status) el.status.textContent = "Erreur d'initialisation : " + (e.message || e);
    }
  });
}

initDashboard();
