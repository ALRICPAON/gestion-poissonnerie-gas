import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, serverTimestamp
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
  btnSaveZ: document.getElementById("btnSaveZ"),
  status: document.getElementById("status"),

  sumCaReel: document.getElementById("sumCaReel"),
  sumAchatsConso: document.getElementById("sumAchatsConso"),
  sumVarStock: document.getElementById("sumVarStock"),
  sumMarge: document.getElementById("sumMarge"),
  sumMargePct: document.getElementById("sumMargePct"),

  stockDebut: document.getElementById("stockDebut"),
  stockFin: document.getElementById("stockFin"),
  achatsPeriode: document.getElementById("achatsPeriode"),
  achatsConso: document.getElementById("achatsConso"),
  caTheo: document.getElementById("caTheo"),
  caReel: document.getElementById("caReel"),

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
    // input week ISO
    const w = getISOWeekNumber(now);
    inputsRow.innerHTML = `
      <label>Semaine
        <input id="inpWeek" type="week">
      </label>
    `;
    // set current week value
    const inp = document.getElementById("inpWeek");
    inp.value = `${now.getFullYear()}-W${String(w).padStart(2,"0")}`;
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

  // events refresh
  inputsRow.querySelectorAll("input").forEach(i=>{
    i.addEventListener("change", refreshDashboard);
  });

  // auto adjust Z input for day mode
  refreshZField();
}

function refreshZField(){
  const d = getSelectedRange().start;
  const zMode = (mode==="day");
  el.zCaHT.disabled = !zMode;
  el.btnSaveZ.disabled = !zMode;
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

/* ---------------- Data loaders ---------------- */

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

/** get nearest inventory BEFORE start, and nearest inventory AT/BEFORE end */
function pickStocks(invs, start, end){
  let stockDebut = 0;
  let stockFin = 0;

  // nearest before start
  const beforeStart = invs.filter(x=>x.date < start);
  if(beforeStart.length){
    stockDebut = beforeStart[beforeStart.length-1].valeur;
  }

  // nearest at/before end
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
      fournisseurCode: r.fournisseurCode || "",
    });
  });

  // factures nécessaires (uniquement celles référencées)
  const factureIds = [...new Set(achats.map(a=>a.factureId).filter(Boolean))];
  const facturesMap = {};
  for(const fid of factureIds){
    const fsnap = await getDoc(doc(db, "factures", fid));
    if(fsnap.exists()){
      const f = fsnap.data();
      facturesMap[fid] = {
        montantFournisseurHT: toNum(f.montantFournisseurHT || 0),
        date: f.date
      };
    }
  }

  // Calcul achats période avec règle :
  // si facture lettrée → on prend facture une seule fois
  // sinon achat
  let achatsPeriodeHT = 0;

  const facturesCounted = new Set();
  for(const a of achats){
    if(a.factureId && facturesMap[a.factureId]){
      if(!facturesCounted.has(a.factureId)){
        achatsPeriodeHT += facturesMap[a.factureId].montantFournisseurHT;
        facturesCounted.add(a.factureId);
      }
    } else {
      achatsPeriodeHT += a.totalHT;
    }
  }

  return { achats, facturesMap, achatsPeriodeHT };
}

/** 3) CA théorique (depuis localStorage inventaireCA, par période)
 *  -> Ici on cumule juste les imports journaliers stockés en local si tu les as.
 *  Si tu veux le mettre en Firestore plus tard, on le branchera.
 */
function loadCaTheorique(start, end){
  // on cherche une clé locale inventaireCA_YYYY-MM-DD si tu veux,
  // sinon fallback inventaireCA global
  let total = 0;
  const oneDay = 86400000;
  for(let t=start.getTime(); t<=end.getTime(); t+=oneDay){
    const key = "inventaireCA_" + ymd(new Date(t));
    const raw = localStorage.getItem(key) || localStorage.getItem("inventaireCA");
    if(!raw) continue;
    try{
      const ventes = JSON.parse(raw||"{}");
      // ventes = {ean: caTTC}, on additionne tout
      total += Object.values(ventes).reduce((s,v)=>s+toNum(v),0);
    }catch(e){}
  }
  return total;
}

/** 4) CA réel HT (Z saisis) */
async function loadCaReel(start, end){
  const user = auth.currentUser;
  const snap = await getDocs(collection(db, "ventes_reelles"));
  const items = [];
  snap.forEach(d=>{
    const r = d.data();
    if(r.userId && user && r.userId!==user.uid) return;
    const dt = new Date(r.date || d.id);
    if(!isFinite(dt)) return;
    if(!inRange(dt, start, end)) return;
    items.push({ date: dt, caHT: toNum(r.caHT||0) });
  });
  const total = items.reduce((s,x)=>s+x.caHT,0);
  return { total, items };
}

/* ---------------- Save Z (day mode only) ---------------- */
async function saveZ(){
  const user = auth.currentUser;
  if(!user) return alert("Non connecté.");

  const { start } = getSelectedRange();
  const dateStr = ymd(start);
  const caHT = toNum(el.zCaHT.value||0);
  if(caHT<=0) return alert("CA HT invalide.");

  await setDoc(doc(db,"ventes_reelles",dateStr),{
    userId: user.uid,
    date: dateStr,
    caHT,
    createdAt: serverTimestamp()
  },{merge:true});

  el.status.textContent = `✅ Z enregistré pour ${dateStr}.`;
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

  // Inventaires
  const invs = await loadInventaires();
  const { stockDebut, stockFin } = pickStocks(invs, start, end);
  const varStock = stockDebut - stockFin;

  // Achats + factures
  const { achatsPeriodeHT } = await loadAchatsAndFactures(start, end);

  // CA
  const caTheo = loadCaTheorique(start, end);
  const { total: caReel, items: zItems } = await loadCaReel(start, end);

  // Achats consommés
  const achatsConsoHT = achatsPeriodeHT + varStock;

  // Marge
  const marge = caReel - achatsConsoHT;
  const margePct = caReel>0 ? (marge/caReel*100) : 0;

  // UI
  el.sumCaReel.textContent = n2(caReel);
  el.sumAchatsConso.textContent = n2(achatsConsoHT);
  el.sumVarStock.textContent = n2(varStock);
  el.sumMarge.textContent = n2(marge);
  el.sumMargePct.textContent = n2(margePct);

  el.tdStockDebut.textContent = `${n2(stockDebut)} €`;
  el.tdStockFin.textContent = `${n2(stockFin)} €`;
  el.tdAchatsPeriode.textContent = `${n2(achatsPeriodeHT)} €`;
  el.tdAchatsConso.textContent = `${n2(achatsConsoHT)} €`;
  el.tdCaTheo.textContent = `${n2(caTheo)} €`;
  el.tdCaReel.textContent = `${n2(caReel)} €`;

  // Z field for selected day
  if(mode==="day"){
    const dayStr = ymd(start);
    const z = zItems.find(x=>ymd(x.date)===dayStr);
    el.zCaHT.value = z ? n2(z.caHT) : "";
  } else {
    el.zCaHT.value = "";
  }

  renderChart(start, end, zItems, achatsPeriodeHT, achatsConsoHT, marge);
}

/* ---------------- Chart ---------------- */
function renderChart(start, end, zItems, achatsPeriodeHT, achatsConsoHT, marge){
  // labels = jours de la période
  const labels = [];
  const caSeries = [];
  const oneDay = 86400000;
  for(let t=start.getTime(); t<=end.getTime(); t+=oneDay){
    const d = new Date(t);
    const key = ymd(d);
    labels.push(key);

    const z = zItems.find(x=>ymd(x.date)===key);
    caSeries.push(z ? z.caHT : 0);
  }

  const achatsSeries = labels.map(()=>0);
  const consoSeries = labels.map(()=>0);
  // On met les totaux en “barres plate” pour la période
  if(labels.length){
    achatsSeries[labels.length-1] = achatsPeriodeHT;
    consoSeries[labels.length-1] = achatsConsoHT;
  }

  if(chart) chart.destroy();
  chart = new Chart(el.chartMain, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label:"CA réel HT (Z)", data: caSeries, type:"line", tension:0.25 },
        { label:"Achats période HT", data: achatsSeries },
        { label:"Achats consommés HT", data: consoSeries },
      ]
    },
    options: {
      responsive:true,
      plugins:{ legend:{ position:"top" } },
      scales:{
        y:{ beginAtZero:true }
      }
    }
  });
}

/* ---------------- Tabs events ---------------- */
tabs.addEventListener("click", (e)=>{
  const btn = e.target.closest(".tab-btn");
  if(!btn) return;
  mode = btn.dataset.mode;

  tabs.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active", b===btn));
  renderInputs();
  refreshDashboard();
});

/* ---------------- Init auth + first render ---------------- */
el.btnSaveZ.addEventListener("click", saveZ);

renderInputs();
auth.onAuthStateChanged(()=>{
  refreshDashboard();
});
