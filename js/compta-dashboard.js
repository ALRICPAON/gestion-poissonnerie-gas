// js/compta-dashboard.js
import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ---------------- Utils ---------------- */
const n2 = v => Number(v||0).toFixed(2);

function toNum(v){
  if(v==null) return 0;
  const s = String(v).trim().replace(/\s/g,"").replace(",",".");
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
}

function toDateAny(v){
  if(!v) return null;
  if(v.toDate) return v.toDate();
  if(v instanceof Date) return v;
  const d = new Date(v);
  return isFinite(d) ? d : null;
}

function ymd(d){
  const x = new Date(d);
  const mm = String(x.getMonth()+1).padStart(2,"0");
  const dd = String(x.getDate()).padStart(2,"0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}

/* ISO week (lundi->dimanche) */
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

/* ---------------- DOM ---------------- */
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
let editingDay = false;          // si on est en mode modification après recalcul
let savedDayData = null;         // cache doc journal du jour si existant

/* TVA (conversion TTC -> HT) */
const TVA_RATE = 0.055; // 5.5% -> HT = TTC / (1 + TVA_RATE)

/* ---------------- Inputs dynamiques selon mode ---------------- */
function renderInputs(){
  inputsRow.innerHTML = "";
  const now = new Date();

  if(mode==="day"){
    inputsRow.innerHTML = `
      <label>Date
        <input id="inpDay" type="date" value="${ymd(now)}">
      </label>
    `;
  }
  if(mode==="week"){
    inputsRow.innerHTML = `
      <label>Semaine
        <input id="inpWeek" type="week">
      </label>
    `;
    const w = getISOWeekNumber(now);
    document.getElementById("inpWeek").value = `${now.getFullYear()}-W${String(w).padStart(2,"0")}`;
  }
  if(mode==="month"){
    inputsRow.innerHTML = `
      <label>Mois
        <input id="inpMonth" type="month" value="${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}">
      </label>
    `;
  }
  if(mode==="year"){
    inputsRow.innerHTML = `
      <label>Année
        <input id="inpYear" type="number" min="2020" step="1" value="${now.getFullYear()}">
      </label>
    `;
  }
  if(mode==="custom"){
    inputsRow.innerHTML = `
      <label>Début
        <input id="inpStart" type="date" value="${ymd(now)}">
      </label>
      <label>Fin
        <input id="inpEnd" type="date" value="${ymd(now)}">
      </label>
    `;
  }

  inputsRow.querySelectorAll("input").forEach(i=>{
    i.addEventListener("change", () => {
      editingDay = false;
      savedDayData = null;
      refreshDashboard();
    });
  });

  refreshHeaderButtons();
  refreshDashboard();
}

function refreshHeaderButtons(){
  const dayMode = (mode === "day");
  el.btnSaveZ.style.display = dayMode ? "" : "none";
  el.btnValiderJournee.style.display = dayMode ? "" : "none";
  el.btnRecalcJournee.style.display = dayMode ? "" : "none";
  el.btnUnvalidateJournee.style.display = dayMode ? "" : "none";
}

/* ISO week number */
function getISOWeekNumber(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}

/* ---------------- Range selon filtres ---------------- */
function getSelectedRange(){
  const now = new Date();
  if(mode==="day"){
    const v = document.getElementById("inpDay")?.value || ymd(now);
    const d = new Date(v);
    const start = new Date(d); start.setHours(0,0,0,0);
    const end = new Date(d); end.setHours(23,59,59,999);
    return { start, end };
  }
  if(mode==="week"){
    const v = document.getElementById("inpWeek")?.value; // "2025-W48"
    if(v){
      const [y, wStr] = v.split("-W");
      const w = Number(wStr);
      const firstThurs = new Date(Number(y),0,1 + (w-1)*7);
      return getISOWeekRange(firstThurs);
    }
    return getISOWeekRange(now);
  }
  if(mode==="month"){
    const v = document.getElementById("inpMonth")?.value; // "2025-11"
    const d = v ? new Date(v+"-01") : now;
    return getMonthRange(d);
  }
  if(mode==="year"){
    const y = Number(document.getElementById("inpYear")?.value || now.getFullYear());
    return getYearRange(y);
  }
  if(mode==="custom"){
    const s = document.getElementById("inpStart")?.value || ymd(now);
    const e = document.getElementById("inpEnd")?.value || ymd(now);
    const start = new Date(s); start.setHours(0,0,0,0);
    const end = new Date(e); end.setHours(23,59,59,999);
    return { start, end };
  }
  return { start: now, end: now };
}

/* ---------------- Data loaders LIVE ---------------- */

/** 1) Inventaires journal_inventaires */
async function loadInventaires(){
  const snap = await getDocs(collection(db, "journal_inventaires"));
  const invs = [];
  snap.forEach(d=>{
    const r = d.data();
    const dateStr = r.date || d.id;
    const dt = new Date(dateStr);
    if(isFinite(dt)) invs.push({ dateStr, date: dt, valeur: toNum(r.valeurStockHT||0) });
  });
  invs.sort((a,b)=>a.date-b.date);
  return invs;
}

/** nearest BEFORE start, and nearest AT/BEFORE end */
function pickStocks(invs, start, end){
  let stockDebut = 0;
  let stockFin = 0;

  const beforeStart = invs.filter(x=>x.date < start);
  if(beforeStart.length){
    stockDebut = beforeStart[beforeStart.length-1].valeur;
  }

  const beforeEnd = invs.filter(x=>x.date <= end);
  if(beforeEnd.length){
    stockFin = beforeEnd[beforeEnd.length-1].valeur;
  }

  return { stockDebut, stockFin };
}

/** 2) Achats + Factures lettrées */
async function loadAchatsAndFactures(start, end){
  const user = auth.currentUser;
  const achatsSnap = await getDocs(collection(db, "achats"));
  const achats = [];
  achatsSnap.forEach(d=>{
    const r = d.data();
    if(r.userId && user && r.userId!==user.uid) return;

    const dt = toDateAny(r.date || r.dateAchat || r.createdAt);
    if(!dt || !inRange(dt, start, end)) return;

    achats.push({
      id: d.id,
      date: dt,
      totalHT: toNum(r.totalHT || r.montantHT || r.total || 0),
      factureId: r.factureId || null,
    });
  });

  const factureIds = [...new Set(achats.map(a=>a.factureId).filter(Boolean))];
  const facturesMap = {};

  for(const fid of factureIds){
    const fsnap = await getDoc(doc(db, "factures", fid));
    if(fsnap.exists()){
      const f = fsnap.data();
      facturesMap[fid] = toNum(f.montantFournisseurHT || 0);
    }
  }

  let achatsPeriodeHT = 0;
  const facturesCounted = new Set();

  for(const a of achats){
    if(a.factureId && facturesMap[a.factureId]){
      if(!facturesCounted.has(a.factureId)){
        achatsPeriodeHT += facturesMap[a.factureId];
        facturesCounted.add(a.factureId);
      }
    } else {
      achatsPeriodeHT += a.totalHT;
    }
  }

  return achatsPeriodeHT;
}

/** 3) CA théorique HT (localStorage) */
function loadCaTheorique(start, end){
  let total = 0;
  const oneDay = 86400000;
  for(let t=start.getTime(); t<=end.getTime(); t+=oneDay){
    const key = "inventaireCA_" + ymd(new Date(t));
    const raw = localStorage.getItem(key) || localStorage.getItem("inventaireCA");
    if(!raw) continue;
    try{
      const ventes = JSON.parse(raw||"{}");
      total += Object.values(ventes).reduce((s,v)=>s+toNum(v),0);
    }catch(e){}
  }
  return total;
}

/* ---------------- Helpers: lire & agréger stock_movements ---------------- */

/** Lire les mouvements dans la plage et ne garder que les sorties pertinentes */
async function loadStockMovementsInRange(start, end){
  // tentative de requête par createdAt (optimisable)
  let snap;
  try {
    snap = await getDocs(query(collection(db, "stock_movements"), where("createdAt", ">=", start), where("createdAt", "<=", end)));
  } catch(e) {
    // fallback : récupérer tout et filtrer client-side si index manquant
    snap = await getDocs(collection(db, "stock_movements"));
  }

  const moves = [];
  snap.forEach(d => {
    const r = d.data();
    const docDate = toDateAny(r.createdAt ?? r.date);
    if(!docDate) return;
    if(!inRange(docDate, start, end)) return;

    const sens = (r.sens || "").toString().toLowerCase();
    const type = (r.type || "").toString().toLowerCase();
    const qty = toNum(r.poids ?? r.quantity ?? 0);

    // Considérer comme sortie si sens === 'sortie' OR qty < 0 OR type semble être une consommation
    const isSortie = sens === "sortie" || qty < 0 || type.includes("consume") || type.includes("consumpt") || (type === "inventory" && sens === "sortie");

    if(!isSortie) return;
    moves.push({ id: d.id, ...r, _date: docDate });
  });
  return moves;
}

/** Agrège CA + coût + maps par fournisseur / article  */
function computeAggregationsFromMovements(moves){
  let totalCA = 0;
  let totalCost = 0;
  const achats_consommes = {};
  const consommation_par_article = {};
  const ventes_par_article = {};

  moves.forEach(r => {
    const qty = toNum(r.poids ?? r.quantity ?? 0);

    // coût : préférence costValue -> montantHT -> prixAchatKg * qty -> pma * qty -> 0
    let cost = 0;
    if(r.costValue !== undefined && r.costValue !== null) {
      cost = toNum(r.costValue);
    } else if(r.montantHT !== undefined && r.montantHT !== null) {
      cost = toNum(r.montantHT);
    } else {
      const prixAchatKg = toNum(r.prixAchatKg ?? r.pma ?? r.unitCost ?? 0);
      cost = prixAchatKg * qty;
    }

    // CA : priorité salePriceHT -> salePriceTTC converti en HT -> 0
    let priceHT = 0;
    if (r.salePriceHT !== undefined && r.salePriceHT !== null && r.salePriceHT !== "") {
      priceHT = toNum(r.salePriceHT);
    } else if (r.salePriceTTC !== undefined && r.salePriceTTC !== null && r.salePriceTTC !== "") {
      // TTC -> HT avec TVA 5.5%
      priceHT = toNum(r.salePriceTTC) / (1 + TVA_RATE);
    } else {
      priceHT = 0;
    }

    const ca = priceHT * qty;

    totalCost += cost;
    totalCA += ca;

    // fournisseur (fallbacks)
    const four = r.fournisseurCode || r.fournisseur || r.fournisseurId || "INCONNU";
    achats_consommes[four] = (achats_consommes[four] || 0) + cost;

    // article / PLU
    const plu = r.plu || r.articleId || (r.lotId ? r.lotId : "INCONNU");
    consommation_par_article[plu] = (consommation_par_article[plu] || 0) + cost;
    ventes_par_article[plu] = (ventes_par_article[plu] || 0) + ca;
  });

  return { totalCA, totalCost, achats_consommes, consommation_par_article, ventes_par_article };
}

/* ---------------- Z et journaux ---------------- */
async function loadZForDate(dateStr){
  const snap = await getDoc(doc(db,"ventes_reelles",dateStr));
  if(!snap.exists()) return { caHT:0, note:"", articles: {} };
  const r = snap.data();
  // On accepte différentes clefs utilisées : articles, ventes, ventesEAN
  return { caHT: toNum(r.caHT||0), note: r.note || "", articles: (r.articles || r.ventes || r.ventesEAN || {}) };
}

/* ---------------- Journaux VALIDÉS ---------------- */

async function getJournal(dateStr){
  const snap = await getDoc(doc(db,"compta_journal",dateStr));
  return snap.exists() ? snap.data() : null;
}

async function loadJournauxRange(start, end){
  const snap = await getDocs(collection(db,"compta_journal"));
  const jours = [];
  snap.forEach(d=>{
    const r = d.data();
    const dt = new Date(r.date || d.id);
    if(!isFinite(dt)) return;
    if(inRange(dt,start,end)) jours.push(r);
  });
  jours.sort((a,b)=>new Date(a.date)-new Date(b.date));
  return jours;
}

/* ---------------- Calcul LIVE d’une journée ---------------- */
async function calculateLiveDay(dateStr){
  const d = new Date(dateStr);
  const start = new Date(d); start.setHours(0,0,0,0);
  const end = new Date(d); end.setHours(23,59,59,999);

  const invs = await loadInventaires();
  const { stockDebut, stockFin } = pickStocks(invs, start, end);
  const varStock = stockDebut - stockFin;

  const achatsPeriodeHT = await loadAchatsAndFactures(start, end);
  const caTheo = loadCaTheorique(start, end);

  const z = await loadZForDate(dateStr);
  const caReel = toNum(z.caHT);
  const note = z.note || "";
  const ventesArticlesFromZ = z.articles || {};

  // --- mouvements (sorties) : consommation réelle / CA réelle par mouvements ---
  const moves = await loadStockMovementsInRange(start, end);
  const aggs = computeAggregationsFromMovements(moves);

  // achats consommés = somme des coûts des sorties (fallback achatsPeriodeHT + varStock)
  const achatsConsoHT = (aggs.totalCost && aggs.totalCost > 0) ? aggs.totalCost : (achatsPeriodeHT + varStock);

  // ventes par article : on préfère les valeurs saisies dans ventes_reelles si présentes
  const ventes_par_article = { ...aggs.ventes_par_article };
  Object.keys(ventesArticlesFromZ).forEach(plu => {
    ventes_par_article[plu] = toNum(ventesArticlesFromZ[plu]);
  });

  const marge = caReel - achatsConsoHT;
  const margePct = caReel>0 ? (marge/caReel*100) : 0;

  return {
    date: dateStr,
    stockDebut, stockFin, varStock,
    achatsPeriodeHT, achatsConsoHT,
    caTheo, caReel,
    marge, margePct,
    noteZ: note,

    // Ajouts : maps utiles pour la validation
    achats_consommes: aggs.achats_consommes,
    consommation_par_article: aggs.consommation_par_article,
    ventes_par_article
  };
}

/* ---------------- UI helpers ---------------- */

function setDayInputsDisabled(disabled){
  el.zCaHT.disabled = disabled;
  el.zNote.disabled = disabled;
  el.btnSaveZ.disabled = disabled;
  el.btnValiderJournee.disabled = disabled;
}

function afficherDonnees(d){
  el.sumCaReel.textContent = n2(d.caReel||0);
  el.sumAchatsConso.textContent = n2(d.achatsConsoHT||0);
  el.sumVarStock.textContent = n2(d.varStock||0);
  el.sumMarge.textContent = n2(d.marge||0);
  el.sumMargePct.textContent = n2(d.margePct||0);

  el.tdStockDebut.textContent = `${n2(d.stockDebut||0)} €`;
  el.tdStockFin.textContent = `${n2(d.stockFin||0)} €`;
  el.tdAchatsPeriode.textContent = `${n2(d.achatsPeriodeHT||0)} €`;
  el.tdAchatsConso.textContent = `${n2(d.achatsConsoHT||0)} €`;
  el.tdCaTheo.textContent = `${n2(d.caTheo||0)} €`;
  el.tdCaReel.textContent = `${n2(d.caReel||0)} €`;
}

/* ---------------- Save Z (jour) ---------------- */
async function saveZ(){
  const user = auth.currentUser;
  if(!user) return alert("Non connecté.");

  const { start } = getSelectedRange();
  const dateStr = ymd(start);

  const caHT = toNum(el.zCaHT.value||0);
  const note = (el.zNote.value||"").trim();

  if(caHT<=0) return alert("CA HT invalide.");

  await setDoc(doc(db,"ventes_reelles",dateStr),{
    userId: user.uid,
    date: dateStr,
    caHT,
    note,
    updatedAt: serverTimestamp()
  },{merge:true});

  el.status.textContent = `✅ Z enregistré pour ${dateStr}.`;
  refreshDashboard();
}

/* ---------------- Valider journée ---------------- */
async function validerJournee(){
  const user = auth.currentUser;
  if(!user) return alert("Non connecté.");

  const { start } = getSelectedRange();
  const dateStr = ymd(start);

  // ------------------ 1) Calcul live ------------------
  const live = await calculateLiveDay(dateStr);

  // ------------------ 2/3/4) Récupérer agrégats depuis calculateLiveDay (qui lit stock_movements) --
  const achats_consommes = live.achats_consommes || {};
  const consommation_par_article = live.consommation_par_article || {};
  const ventes_par_article = live.ventes_par_article || {};

  // ------------------ 5) Save journal complet ------------------
  await setDoc(doc(db,"compta_journal",dateStr),{
    userId: user.uid,
    validated: true,
    ...live,

    // AJOUTS POUR MODULE STATISTIQUES :
    achats_consommes,
    ventes_par_article,
    consommation_par_article,

    createdAt: serverTimestamp()
  },{merge:true});

  editingDay = false;
  el.status.textContent = `✔ Journée ${dateStr} validée et archivée (stats mises à jour).`;
  refreshDashboard();
}

/* ---------------- Recalculer / Modifier journée ---------------- */
async function recalcJournee(){
  const { start } = getSelectedRange();
  const dateStr = ymd(start);

  const saved = await getJournal(dateStr);
  if(!saved) return alert("Journée non validée → rien à recalculer.");

  // A/B = OUI : on garde CA réel + note
  const caKeep = toNum(saved.caReel || 0);
  const noteKeep = saved.noteZ || "";

  const live = await calculateLiveDay(dateStr);
  live.caReel = caKeep;
  live.noteZ = noteKeep;

  // on passe en mode édition
  editingDay = true;
  savedDayData = saved;

  // inputs restent éditables
  setDayInputsDisabled(false);
  el.zCaHT.value = n2(caKeep);
  el.zNote.value = noteKeep;

  afficherDonnees(live);
  el.status.textContent = `♻ Journée ${dateStr} recalculée (stock/achats/CA theo). Tu peux re-valider.`;

  // on stocke temporairement pour revalidation
  window.__liveDayTemp = live;
}

/* ---------------- Supprimer validation ---------------- */
async function unvalidateJournee(){
  const { start } = getSelectedRange();
  const dateStr = ymd(start);

  if(!confirm(`Supprimer la validation du ${dateStr} ?`)) return;

  await deleteDoc(doc(db,"compta_journal",dateStr));

  editingDay = false;
  savedDayData = null;
  el.status.textContent = `🗑️ Validation supprimée pour ${dateStr}.`;
  refreshDashboard();
}

/* ---------------- Main refresh ---------------- */
async function refreshDashboard(){
  const user = auth.currentUser;
  if(!user){
    el.status.textContent = "Connecte-toi pour voir le tableau de bord.";
    return;
  }

  const { start, end } = getSelectedRange();

  // Modes période : on cumule UNIQUEMENT journaux validés
  if(mode !== "day"){
    const jours = await loadJournauxRange(start,end);

    const sum = (k)=> jours.reduce((s,j)=> s + toNum(j[k]||0), 0);

    const caReel = sum("caReel");
    const achatsConso = sum("achatsConsoHT");
    const varStock = sum("varStock");
    const marge = sum("marge");
    const margePct = caReel>0 ? (marge/caReel*100) : 0;

    const data = {
      caReel,
      achatsConsoHT: achatsConso,
      varStock,
      marge,
      margePct,
      stockDebut: sum("stockDebut"),
      stockFin: sum("stockFin"),
      achatsPeriodeHT: sum("achatsPeriodeHT"),
      caTheo: sum("caTheo")
    };

    afficherDonnees(data);
    renderChartFromJournaux(jours);

    el.zCaHT.value = "";
    el.zNote.value = "";
    setDayInputsDisabled(true);
    return;
  }

  // Mode JOUR
  const dateStr = ymd(start);

  // si on est en édition (après recalc), on affiche le live temp
  if(editingDay && window.__liveDayTemp && window.__liveDayTemp.date===dateStr){
    const d = window.__liveDayTemp;
    afficherDonnees(d);
    renderChartFromJournaux([d]);
    setDayInputsDisabled(false);
    return;
  }

  // sinon : on check journal validé
  const saved = await getJournal(dateStr);
  savedDayData = saved;

  if(saved){
    // affichage ARCHIVÉ
    afficherDonnees(saved);
    renderChartFromJournaux([saved]);

    el.zCaHT.value = n2(saved.caReel||0);
    el.zNote.value = saved.noteZ || "";

    setDayInputsDisabled(true);
    el.btnRecalcJournee.disabled = false;
    el.btnUnvalidateJournee.disabled = false;
    el.status.textContent = `✔ Journée ${dateStr} validée (lecture archivage).`;
    return;
  }

  // sinon calcul live
  const live = await calculateLiveDay(dateStr);
  afficherDonnees(live);
  renderChartFromJournaux([live]);

  el.zCaHT.value = live.caReel ? n2(live.caReel) : "";
  el.zNote.value = live.noteZ || "";

  setDayInputsDisabled(false);
  el.btnRecalcJournee.disabled = true;
  el.btnUnvalidateJournee.disabled = true;
  el.status.textContent = `Journée non validée → calcul en direct.`;
}

/* ---------------- Chart from journaux ---------------- */
function renderChartFromJournaux(jours){
  const labels = jours.map(j=>j.date);
  const ca = jours.map(j=>toNum(j.caReel||0));
  const achatsConso = jours.map(j=>toNum(j.achatsConsoHT||0));
  const marge = jours.map(j=>toNum(j.marge||0));

  if(chart) chart.destroy();
  chart = new Chart(el.chartMain, {
    data: {
      labels,
      datasets: [
        { label:"CA réel HT", data: ca, type:"line", tension:0.25 },
        { label:"Achats consommés HT", data: achatsConso, type:"bar" },
        { label:"Marge brute HT", data: marge, type:"bar" },
      ]
    },
    options: {
      responsive:true,
      plugins:{ legend:{ position:"top" } },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

/* ---------------- Tabs events ---------------- */
tabs.addEventListener("click", (e)=>{
  const btn = e.target.closest(".tab-btn");
  if(!btn) return;
  mode = btn.dataset.mode;

  tabs.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active", b===btn));
  editingDay = false;
  savedDayData = null;
  renderInputs();
});

/* ---------------- Events ---------------- */
el.btnSaveZ.addEventListener("click", saveZ);
el.btnValiderJournee.addEventListener("click", validerJournee);
el.btnRecalcJournee.addEventListener("click", recalcJournee);
el.btnUnvalidateJournee.addEventListener("click", unvalidateJournee);

/* ---------------- Init ---------------- */
renderInputs();
auth.onAuthStateChanged(()=> refreshDashboard());
