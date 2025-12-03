// js/compta-dashboard.js
import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, deleteDoc, serverTimestamp, Timestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* =========================
   Permissions helpers
   ========================= */
let _currentUserHasCompta = false;

async function hasComptaAccess(user) {
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, 'app_users', user.uid));
    if (!snap.exists()) return false;
    const d = snap.data();
    if (d.role === 'admin') return true;
    return Array.isArray(d.modules) && d.modules.includes('compta');
  } catch (e) {
    console.error('Erreur hasComptaAccess:', e);
    return false;
  }
}

async function ensureCompta(user) {
  const ok = await hasComptaAccess(user);
  if (!ok) throw new Error('Accès refusé : vous n’avez pas le droit Comptabilité');
  return true;
}

/* =========================
   Utils
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
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isFinite(d) ? d : null;
}
function ymd(d) {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}

/* ISO helpers */
function getISOWeekRange(date){
  const d = new Date(date);
  const day = (d.getDay()+6)%7; // 0=lundi
  const start = new Date(d); start.setDate(d.getDate()-day);
  start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+6);
  end.setHours(23,59,59,999);
  return { start, end };
}
function getMonthRange(date){
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0,0,0,0);
  const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
  end.setHours(23,59,59,999);
  return { start, end };
}
function getYearRange(year){
  const start = new Date(year,0,1); start.setHours(0,0,0,0);
  const end = new Date(year,11,31); end.setHours(23,59,59,999);
  return { start, end };
}
function inRange(d, start, end){
  if(!d) return false;
  return d>=start && d<=end;
}

/* TVA utilisée dans le projet (conversion TTC->HT) */
const TVA_RATE = 0.055; // 5.5%

/* =========================
   DOM bindings (page: compta-dashboard.html)
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
   Render inputs based on mode
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
    document.getElementById("inpWeek").value = `${now.getFullYear()}-W${String(w).padStart(2,"0")}`;
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

function getISOWeekNumber(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}

function refreshHeaderButtons(){
  const dayMode = (mode === "day");
  el.btnSaveZ.style.display = dayMode ? "" : "none";
  el.btnValiderJournee.style.display = dayMode ? "" : "none";
  el.btnRecalcJournee.style.display = dayMode ? "" : "none";
  el.btnUnvalidateJournee.style.display = dayMode ? "" : "none";
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
   Data loaders
   ========================= */
async function loadInventaires() {
  const snap = await getDocs(collection(db, "journal_inventaires"));
  const invs = [];
  snap.forEach(d => {
    const r = d.data();
    const dateStr = r.date || d.id;
    const dt = new Date(dateStr);
    if (isFinite(dt)) invs.push({ dateStr, date: dt, valeur: toNum(r.valeurStockHT || 0) });
  });
  invs.sort((a,b) => a.date - b.date);
  return invs;
}

/** nearest BEFORE start, and nearest AT/BEFORE end */
function pickStocks(invs, start, end) {
  let stockDebut = 0; let stockFin = 0;
  const beforeStart = invs.filter(x => x.date < start);
  if (beforeStart.length) stockDebut = beforeStart[beforeStart.length - 1].valeur;
  const beforeEnd = invs.filter(x => x.date <= end);
  if (beforeEnd.length) stockFin = beforeEnd[beforeEnd.length - 1].valeur;
  return { stockDebut, stockFin };
}

/* =========================
   Reconstruction stock value at T (lots + stock_movements)
   ========================= */
async function computeStockValueAt(dateISO) {
  const dateT = new Date(dateISO + "T23:59:59");
  // load lots
  const lotsSnap = await getDocs(collection(db, "lots"));
  const lotsMap = {};
  lotsSnap.forEach(d => lotsMap[d.id] = d.data());

  // load movements up to dateT
  let movesSnap;
  try {
    movesSnap = await getDocs(query(collection(db, "stock_movements"), where("createdAt", "<=", Timestamp.fromDate(dateT))));
  } catch (e) {
    // fallback: read all and filter
    movesSnap = await getDocs(collection(db, "stock_movements"));
  }

  const stateByLot = {};
  movesSnap.forEach(d => {
    const m = d.data();
    const created = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : (m.date ? new Date(m.date + "T00:00:00") : null);
    if (!created || created > dateT) return;
    if (m.ignoreForCompta) return;
    const lotId = m.lotId || ("PLU__" + (m.plu || m.articleId || "UNKNOWN"));
    if (!stateByLot[lotId]) stateByLot[lotId] = {
      in: 0, out: 0,
      priceFromLot: (lotsMap[lotId] && (lotsMap[lotId].prixAchatKg || lotsMap[lotId].prixAchatKg === 0)) ? Number(lotsMap[lotId].prixAchatKg) : null
    };
    const qty = Number(m.poids ?? m.quantity ?? 0) || 0;
    const sens = (m.sens || "").toString().toLowerCase();
    if (sens === "sortie" || qty < 0) stateByLot[lotId].out += Math.abs(qty);
    else {
      stateByLot[lotId].in += qty;
      if (!stateByLot[lotId].priceFromLot && (m.prixAchatKg || m.montantHT)) {
        stateByLot[lotId].priceFromLot = Number(m.prixAchatKg || (m.montantHT / Math.max(1, qty)));
      }
    }
  });

  let totalValue = 0;
  const perLot = {};
  for (const lotId in stateByLot) {
    const s = stateByLot[lotId];
    const remaining = Math.max(0, s.in - s.out);
    const price = Number(s.priceFromLot || 0);
    const val = remaining * price;
    perLot[lotId] = { remaining, price, val };
    totalValue += val;
  }
  return { totalValue, perLot };
}

/* =========================
   Load ventes réelles (helper)
   ========================= */
async function loadVentesReelles(from, to) {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T23:59:59");
  const oneDay = 24*3600*1000;
  let totalVentes = 0;
  const ventesEAN = {};
  for (let t = start.getTime(); t <= end.getTime(); t += oneDay) {
    const dateStr = new Date(t).toISOString().slice(0,10);
    try {
      const snap = await getDoc(doc(db, "ventes_reelles", dateStr));
      if (!snap.exists()) continue;
      const o = snap.data();
      if (o.caHT) totalVentes += toNum(o.caHT);
      else if (o.ventes && typeof o.ventes === "object") {
        for (const e in o.ventes) { ventesEAN[e] = (ventesEAN[e] || 0) + toNum(o.ventes[e]); totalVentes += toNum(o.ventes[e]); }
      } else if (o.ventesEAN && typeof o.ventesEAN === "object") {
        for (const e in o.ventesEAN) { ventesEAN[e] = (ventesEAN[e] || 0) + toNum(o.ventesEAN[e]); totalVentes += toNum(o.ventesEAN[e]); }
      } else if (o.totalCA) totalVentes += toNum(o.totalCA);
      else if (o.caTTC) totalVentes += toNum(o.caTTC);
    } catch (e) { console.warn("loadVentesReelles err", e); }
  }
  return { totalVentes, ventesEAN };
}

/* =========================
   Core period compta calculation (recommended)
   ========================= */
async function computePeriodCompta(fromISO, toISO) {
  // 1) stockDebut / stockFin from journal_inventaires
  const invs = await loadInventaires();
  const { stockDebut, stockFin } = pickStocks(invs, new Date(fromISO + "T00:00:00"), new Date(toISO + "T23:59:59"));

  // 2) achatsPeriode: sum of achats (by date) — prioritizable with lettrage
  let achatsPeriode = 0;
  try {
    const snapAchats = await getDocs(collection(db, "achats"));
    snapAchats.forEach(d => {
      const r = d.data();
      const dDate = toDateAny(r.date || r.dateAchat || r.createdAt);
      if (!dDate) return;
      if (dDate < new Date(fromISO + "T00:00:00") || dDate > new Date(toISO + "T23:59:59")) return;
      const montant = toNum(r.totalHT || r.montantHT || r.total || 0);
      achatsPeriode += montant;
    });
  } catch (e) {
    console.warn("computePeriodCompta: load achats error", e);
  }

  // 3) achatsConsoMovements: value of sorties by lot price
  const lotsSnap = await getDocs(collection(db, "lots"));
  const lots = {};
  lotsSnap.forEach(d => lots[d.id] = d.data());

  const movesSnapAll = await getDocs(collection(db, "stock_movements"));
  let achatsConsoMovements = 0;
  movesSnapAll.forEach(d => {
    const m = d.data();
    const created = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : (m.date ? new Date(m.date + "T00:00:00") : null);
    if (!created) return;
    if (created < new Date(fromISO + "T00:00:00") || created > new Date(toISO + "T23:59:59")) return;
    if (m.ignoreForCompta) return;
    const sens = (m.sens || "").toString().toLowerCase();
    if (sens !== "sortie") return;
    const type = (m.type || m.origin || "").toString().toLowerCase();
    if (type === "transformation" || type === "correction") return;
    const poids = Math.abs(Number(m.poids ?? m.quantity ?? 0) || 0);
    if (!poids) return;
    const lot = lots[m.lotId] || {};
    const prixKg = toNum(lot.prixAchatKg || m.prixAchatKg || m.prixAchat || 0);
    achatsConsoMovements += prixKg * poids;
  });

  // 4) caTheorique (we try to read ventes_reelles; fallback 0)
  let caTheorique = 0;
  try {
    const ventes = await loadVentesReelles(fromISO, toISO);
    caTheorique = ventes.totalVentes / (1 + TVA_RATE); // make HT
  } catch (e) { console.warn("caTheorique load err", e); }

  // 5) caReel: sum from compta_journal between dates
  let caReel = 0;
  try {
    const q = query(collection(db, "compta_journal"), where("date", ">=", fromISO), where("date", "<=", toISO));
    const snap = await getDocs(q);
    snap.forEach(d => { caReel += toNum(d.data().caReel || d.data().caHT || 0); });
  } catch (e) { console.warn("caReel load err", e); }

  // 6) final achats consommés: prefer mouvements if present
  const achats_consomes_final = (achatsConsoMovements > 0) ? achatsConsoMovements : (stockDebut + achatsPeriode - stockFin);
  const marge = caReel - achats_consomes_final;
  const margePct = caReel ? (marge / caReel * 100) : 0;

  return {
    stockDebut: round2(stockDebut),
    stockFin: round2(stockFin),
    achatsPeriode: round2(achatsPeriode),
    achatsConsoMovements: round2(achatsConsoMovements),
    achats_consomes_final: round2(achats_consomes_final),
    caTheorique: round2(caTheorique),
    caReel: round2(caReel),
    marge: round2(marge),
    margePct: round2(margePct)
  };
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

/* =========================
   UI: render dashboard
   ========================= */
async function refreshDashboard() {
  try {
    el.status.textContent = "Chargement…";
    const range = getSelectedRange();
    const fromISO = range.start.toISOString().slice(0,10);
    const toISO = range.end.toISOString().slice(0,10);

    // compute
    const res = await computePeriodCompta(fromISO, toISO);

    // fill UI
    el.tdStockDebut.textContent = `${n2(res.stockDebut)} €`;
    el.tdStockFin.textContent = `${n2(res.stockFin)} €`;
    el.tdAchatsPeriode.textContent = `${n2(res.achatsPeriode)} €`;
    el.tdAchatsConso.textContent = `${n2(res.achats_consomes_final)} €`;
    el.tdCaTheo.textContent = `${n2(res.caTheorique)} €`;
    el.tdCaReel.textContent = `${n2(res.caReel)} €`;

    el.sumCaReel.textContent = n2(res.caReel);
    el.sumAchatsConso.textContent = n2(res.achats_consomes_final);
    const varStock = round2(res.stockDebut - res.stockFin);
    el.sumVarStock.textContent = n2(varStock);
    el.sumMarge.textContent = n2(res.marge);
    el.sumMargePct.textContent = (round2(res.margePct) || 0).toFixed(1);

    // chart summary (simple)
    renderChart([
      { label: "CA réel HT", value: res.caReel },
      { label: "Achats consommés HT", value: res.achats_consomes_final },
      { label: "Variation stock HT", value: varStock }
    ]);

    el.status.textContent = "";
  } catch (e) {
    console.error(e);
    el.status.textContent = "Erreur lors du calcul : " + (e.message || e);
  }
}

function renderChart(items) {
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
   Z (CA réel) & validation
   ========================= */
async function saveZForDay(dateISO) {
  const zht = toNum(el.zCaHT.value || 0);
  const note = (el.zNote.value || "").trim();
  if (!zht) {
    // allow zero but warn
    // continue
  }
  const docRef = doc(db, "compta_journal", dateISO);
  await setDoc(docRef, {
    date: dateISO,
    caReel: zht,
    zNote: note,
    validated: false,
    updatedAt: serverTimestamp()
  }, { merge: true });
  el.status.textContent = `Z enregistré pour ${dateISO}`;
  refreshDashboard();
}

async function validerJournee(dateISO) {
  // compute and store full snapshot
  const start = dateISO; const end = dateISO;
  const calc = await computePeriodCompta(start, end);
  // read existing Z if present
  const zFromField = toNum(el.zCaHT.value || 0);
  let caReel = calc.caReel;
  if (zFromField > 0) caReel = zFromField;
  const payload = {
    date: dateISO,
    stockDebut: calc.stockDebut,
    stockFin: calc.stockFin,
    achatsPeriode: calc.achatsPeriode,
    achatsConsoMovements: calc.achatsConsoMovements,
    achatsConsoFinal: calc.achats_consomes_final,
    caTheorique: calc.caTheorique,
    caReel,
    marge: round2(caReel - calc.achats_consomes_final),
    margePct: (caReel ? round2((caReel - calc.achats_consomes_final) / caReel * 100) : 0),
    validated: true,
    validatedAt: serverTimestamp(),
    zNote: (el.zNote.value || "").trim()
  };
  await setDoc(doc(db, "compta_journal", dateISO), payload, { merge: true });

  el.status.textContent = `Journée ${dateISO} validée.`;
  refreshDashboard();
}

async function unvalidateJournee(dateISO) {
  const ref = doc(db, "compta_journal", dateISO);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    el.status.textContent = "Aucune validation trouvée pour cette date.";
    return;
  }
  await updateDoc(ref, { validated: false, validatedAt: serverTimestamp() });
  el.status.textContent = `Validation supprimée pour ${dateISO}.`;
  refreshDashboard();
}

/* =========================
   Event bindings
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

  el.btnSaveZ.addEventListener("click", async () => {
    const day = document.getElementById("inpDay")?.value;
    if (!day) return alert("Choisis une date.");
    await saveZForDay(day);
  });

  el.btnValiderJournee.addEventListener("click", async () => {
    const day = document.getElementById("inpDay")?.value;
    if (!day) return alert("Choisis une date.");
    if (!confirm(`Valider la journée ${day} (figer la marge) ?`)) return;
    await validerJournee(day);
  });

  el.btnRecalcJournee.addEventListener("click", async () => {
    editingDay = true;
    savedDayData = null;
    await refreshDashboard();
    el.status.textContent = "Recalcul effectué — tu peux modifier le Z avant validation.";
  });

  el.btnUnvalidateJournee.addEventListener("click", async () => {
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
        el.status.textContent = "Connecte-toi pour voir le module Comptabilité.";
        return;
      }
      const ok = await hasComptaAccess(user);
      if (!ok) {
        el.status.textContent = "Accès refusé au module Comptabilité.";
        return;
      }
      wireEvents();
      renderInputs();
      refreshDashboard();
    } catch (e) {
      console.error(e);
      el.status.textContent = "Erreur d'initialisation : " + (e.message || e);
    }
  });
}

initDashboard();
