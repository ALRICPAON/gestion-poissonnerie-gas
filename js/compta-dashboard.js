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
/* =========================
   Purchases robustes + debug (AJOUT manquant)
   Remplacer le placeholder par ce bloc
   ========================= */

/** Option: mettre true pour ne compter QUE les BL reçus (sécurité métier) */
const ONLY_BL_RECEIVED = false;

/**
 * getPurchasesForRange(fromISO, toISO)
 * - fromISO/toISO = 'YYYY-MM-DD' (local)
 * - Utilise uniquement r.date (ou r.dateAchat), pas createdAt
 */
async function getPurchasesForRange(fromISO, toISO) {
  try {
    const snap = await getDocs(collection(db, "achats"));
    const isSingle = (fromISO === toISO);
    const included = [];
    const excludedNear = [];
    let total = 0;

    snap.forEach(docSnap => {
      const r = docSnap.data();

      // 1) header date strict
      const headerRaw = (r.date !== undefined && r.date !== null) ? r.date
                        : (r.dateAchat !== undefined && r.dateAchat !== null) ? r.dateAchat
                        : null;
      if (!headerRaw) return;

      // 2) normalize to local YYYY-MM-DD using headerDateToISO
      const headerISO = headerDateToISO(headerRaw);
      if (!headerISO) return;

      // 3) optional business filter
      if (ONLY_BL_RECEIVED) {
        if (String(r.type || "").toUpperCase() !== "BL") return;
        if (String(r.statut || "").toLowerCase() !== "received") return;
      }

      // 4) match
      const matches = isSingle ? (headerISO === fromISO) : (headerISO >= fromISO && headerISO <= toISO);

      if (matches) {
        const montant = toNum(r.montantHT || r.totalHT || r.montant || 0);
        total += montant;
        included.push({
          id: docSnap.id,
          headerRaw,
          headerISO,
          montantHT: round2(montant),
          type: r.type || null,
          statut: r.statut || null
        });
      } else {
        if (!isSingle) return;
        // collect nearby dates for debug (±2 jours)
        const diffMs = Math.abs(new Date(headerISO) - new Date(fromISO));
        if (diffMs <= 2 * 24 * 3600 * 1000) {
          excludedNear.push({
            id: docSnap.id,
            headerRaw,
            headerISO,
            montantHT: round2(toNum(r.montantHT || r.totalHT || r.montant || 0)),
            type: r.type || null,
            statut: r.statut || null
          });
        }
      }
    });

    console.group(`getPurchasesForRange ${fromISO}..${toISO}`);
    console.log("ONLY_BL_RECEIVED:", ONLY_BL_RECEIVED);
    console.log("Included count:", included.length, "Total montant:", round2(total));
    if (included.length) console.table(included);
    if (excludedNear.length) {
      console.log("Excluded (nearby dates) — helpful for debugging:");
      console.table(excludedNear);
    }
    console.groupEnd();

    return round2(total);
  } catch (err) {
    console.error("getPurchasesForRange err:", err);
    return 0;
  }
}

async function getPurchasesForDate(dateISO) {
  return await getPurchasesForRange(dateISO, dateISO);
}

/** debugListPurchasesForDate(dateISO) — affiche docs dont headerISO === dateISO */
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
        out.push({ id: docSnap.id, headerRaw, headerISO, type: r.type, statut: r.statut, montantHT: montant });
      }
    });
    console.group(`debugListPurchasesForDate ${dateISO} -> ${out.length} docs`);
    console.table(out);
    console.log("DEBUG sum:", round2(out.reduce((s, x) => s + toNum(x.montantHT), 0)));
    console.groupEnd();
    return out;
  } catch (e) {
    console.error("debugListPurchasesForDate err", e);
    return [];
  }
}

/** inspectPurchases(ids) — affiche raw doc pour diagnostics (headerRaw, createdAt, etc.) */
async function inspectPurchases(ids) {
  for (const id of ids) {
    try {
      const snap = await getDoc(doc(db, "achats", id));
      if (!snap.exists()) { console.log(id, "-> missing"); continue; }
      const r = snap.data();
      console.group(`achat ${id}`);
      console.log("raw:", r);
      const headerRaw = (r.date !== undefined && r.date !== null) ? r.date : (r.dateAchat !== undefined ? r.dateAchat : null);
      console.log("headerRaw:", headerRaw);
      if (headerRaw && typeof headerRaw.toDate === 'function') {
        const d = headerRaw.toDate();
        console.log("headerLocal:", d.toString(), "headerISO(local):", localDateISO(d));
      } else if (headerRaw) {
        const parsed = new Date(headerRaw);
        console.log("headerParsed:", parsed.toString(), "headerISO(local):", localDateISO(parsed));
      }
      if (r.createdAt && typeof r.createdAt.toDate === 'function') {
        const c = r.createdAt.toDate();
        console.log("createdAt local:", c.toString(), "createdAt ISO:", c.toISOString());
      } else console.log("createdAt:", r.createdAt);
      console.log("montantHT:", r.montantHT, "type:", r.type, "statut:", r.statut);
      console.groupEnd();
    } catch (e) {
      console.error("inspect error", id, e);
    }
  }
}


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

// Remplace ou colle cette fonction dans ton fichier (remplace l'ancienne computeStockValueForDate)
async function computeStockValueForDate(dateISO) {
  const dateT = new Date(dateISO + "T23:59:59");
  const perPlu = {};
  let totalValue = 0;
  const missingPrices = new Set();
  const uncertainLots = [];

  // Helper pour extraire une quantité depuis un mouvement (plusieurs noms possibles)
  function extractQty(m) {
    // try many candidate fields
    const cand = [
      m.qty, m.quantity, m.quantite, m.qte, m.kg, m.poids, m.poidsKg, m.delta, m.deltaKg, m.delta_kg, m.qteKg,
      m.amount, m.value
    ];
    for (const c of cand) {
      if (c === undefined || c === null) continue;
      const n = toNum(c);
      if (n !== 0) return n; // return non-zero or zero if explicitly zero
      // if c is numeric zero, still return 0 (we accept it)
      if (typeof c === 'number' && c === 0) return 0;
    }
    // try parsing from string fields that include a number
    const sCandidates = [m.note, m.comment, m.info, m.meta];
    for (const s of sCandidates) {
      if (!s || typeof s !== 'string') continue;
      const mnum = s.match(/-?\d+(\.\d+)?/);
      if (mnum) return toNum(mnum[0]);
    }
    return null; // not found
  }

  // Heuristique pour décider si un mouvement est "sortie" (décrémente) ou "entrée" (incrémente)
  function isOutgoingMovement(m) {
    const t = String((m.type || m.operation || m.action || m.op || m.nom || "")).toLowerCase();
    // mots qui indiquent sortie/vente/consommation
    const outKeywords = ["sale","vente","out","sortie","consum","prelev","remove","sold","consomm","dispatch","dispatch"];
    const inKeywords = ["in","recept","reception","enter","entrée","recette","receive","ajout","purchase","inbound"];
    for (const k of outKeywords) if (t.includes(k)) return true;
    for (const k of inKeywords) if (t.includes(k)) return false;
    // if movement has a signed quantity negative -> outgoing
    const q = extractQty(m);
    if (q !== null && q < 0) return true;
    // fallback: unknown -> return null (we cannot decide)
    return null;
  }

  // 1) read lots (created <= dateT)
  let lots = [];
  try {
    const snapLots = await getDocs(collection(db, "lots"));
    snapLots.forEach(d => {
      const l = d.data();
      // normalize createdAt/updatedAt to Date
      let created = null;
      if (l.createdAt && typeof l.createdAt.toDate === 'function') created = l.createdAt.toDate();
      else created = toDateAny(l.createdAt);
      if (!created) return;
      if (created > dateT) return; // lot created after dateT -> ignore
      let updated = null;
      if (l.updatedAt && typeof l.updatedAt.toDate === 'function') updated = l.updatedAt.toDate();
      else updated = toDateAny(l.updatedAt);

      // standardize fields
      const lotObj = {
        lotId: d.id,
        raw: l,
        created,
        updated,
        plu: String(l.plu || l.PLU || l.pluCode || l.code || l.articleId || "").trim(),
        poidsInitial: toNum(l.poidsInitial ?? l.poids ?? l.initialWeight ?? 0),
        poidsRestant: (l.poidsRestant !== undefined && l.poidsRestant !== null) ? toNum(l.poidsRestant) : null,
        prixAchatKg: toNum(l.prixAchatKg ?? l.prixAchat ?? l.buyPrice ?? 0),
        closed: !!l.closed
      };
      if (!lotObj.plu) return;
      lots.push(lotObj);
    });
  } catch (e) {
    console.warn("computeStockValueForDate: error reading lots", e);
  }

  // If no lots -> fallback to previous method (journal_inventaires)
  if (!lots.length) {
    // call previous fallback logic (existing code) or reuse computeStockValueForDate old
    // For brevity, return empty and let caller fallback, or you can call previous logic here
    return { totalValue: 0, perPlu: {}, missingPrices: [], uncertainLots: [] };
  }

  // 2) read stock_movements up to dateT and group by lotId (one query)
  const movementsByLot = {};
  try {
    const q = query(collection(db, "stock_movements"), where("createdAt", "<=", Timestamp.fromDate(dateT)));
    const snapMov = await getDocs(q);
    snapMov.forEach(ds => {
      const m = ds.data();
      const lid = String(m.lotId || m.lot || m.lot_id || m.ligneId || "").trim();
      if (!lid) return;
      if (!movementsByLot[lid]) movementsByLot[lid] = [];
      // store created Date for sorting & raw
      let created = null;
      if (m.createdAt && typeof m.createdAt.toDate === 'function') created = m.createdAt.toDate();
      else created = toDateAny(m.createdAt);
      movementsByLot[lid].push(Object.assign({ created }, m));
    });
    // sort each list by created asc
    for (const k of Object.keys(movementsByLot)) {
      movementsByLot[k].sort((a,b) => (a.created ? a.created.getTime() : 0) - (b.created ? b.created.getTime() : 0));
    }
  } catch (e) {
    console.warn("computeStockValueForDate: error reading stock_movements", e);
  }

  // 3) for each lot, determine weightAtDate: if updated <= dateT use poidsRestant; else reconstruct
  for (const lot of lots) {
    const { lotId, plu, poidsInitial, poidsRestant, prixAchatKg, updated } = lot;
    let weightAtDate = null;
    let uncertain = false;
    let uncertainNotes = [];

    // if updated is absent or updated <= dateT => poidsRestant assumed valid
    if (!updated || updated <= dateT) {
      weightAtDate = (poidsRestant !== null ? poidsRestant : poidsInitial || 0);
    } else {
      // need to reconstruct from movements
      // start with poidsInitial
      let weight = (poidsInitial || 0);
      const moves = movementsByLot[lotId] || [];
      if (!moves.length) {
        // no movements found — can't reconstruct precisely
        uncertain = true;
        uncertainNotes.push("aucun mouvement trouvé pour lot, poidsRestant actuel non applicable (updated>dateT)");
        // fallback: use poidsInitial as approximation (but mark uncertain)
        weight = poidsInitial || 0;
      } else {
        // apply movements in chronological order
        for (const m of moves) {
          // extract numeric qty
          const q = extractQty(m);
          let delta = null;
          if (q !== null) {
            // If quantity is negative, use as-is (outgoing)
            if (q < 0) {
              delta = q; // negative reduces weight
            } else {
              // if movement type indicates outgoing, subtract; if incoming, add
              const outgoing = isOutgoingMovement(m);
              if (outgoing === true) delta = -Math.abs(q);
              else if (outgoing === false) delta = Math.abs(q);
              else {
                // unknown direction: try to infer common cases
                // if m has field 'delta' negative -> use delta
                if (typeof m.delta === 'number') delta = toNum(m.delta);
                else {
                  // cannot determine sign reliably -> mark uncertain and skip applying
                  uncertain = true;
                  uncertainNotes.push(`mvt inconnu ${m.id || ''} type:${m.type || m.operation || ''} qty:${q}`);
                  continue;
                }
              }
            }
          } else {
            // no qty info -> uncertain
            uncertain = true;
            uncertainNotes.push(`mvt sans qty ${m.id || ''} type:${m.type || m.operation || ''}`);
            continue;
          }

          // apply delta
          weight = weight + delta;
          if (weight < 0) weight = 0; // clamp
        }
      }
      weightAtDate = round2(weight);
    }

    // finalize: compute lot value
    const buy = prixAchatKg || null;
    const val = (buy && weightAtDate) ? round2(buy * weightAtDate) : 0;

    // aggregate by PLU
    if (!perPlu[plu]) perPlu[plu] = { counted: 0, buyPrice: null, value: 0, lots: [] };
    perPlu[plu].counted = round2((perPlu[plu].counted || 0) + weightAtDate);
    perPlu[plu].value = round2((perPlu[plu].value || 0) + val);
    perPlu[plu].lots.push({
      lotId,
      poidsAtDate: weightAtDate,
      prixAchatKg: buy,
      value: val,
      createdAt: lot.created ? lot.created.toISOString() : null,
      updatedAt: lot.updated ? lot.updated.toISOString() : null,
      uncertain,
      uncertainNotes
    });

    if (!buy || buy === 0) missingPrices.add(plu);
    if (uncertain) uncertainLots.push({ lotId, plu, notes: uncertainNotes });

    totalValue += val;
  }

  // compute buyPrice per PLU as weighted average
  for (const p of Object.keys(perPlu)) {
    const info = perPlu[p];
    let totalWeight = 0, totalVal = 0;
    info.lots.forEach(l => {
      totalWeight += toNum(l.poidsAtDate || 0);
      totalVal += toNum(l.value || 0);
    });
    info.buyPrice = totalWeight ? round2(totalVal / totalWeight) : (info.lots[0]?.prixAchatKg ?? null);
    info.counted = round2(info.counted);
    info.value = round2(info.value);
  }

  return {
    totalValue: round2(totalValue),
    perPlu,
    missingPrices: Array.from(missingPrices),
    uncertainLots
  };
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

  // --- CA THÉORIQUE : poidsVendu * salePriceTTC (converti HT) ---
let caTheorique = 0;
const caParPlu = {}; // debug : { plu: { poidsVendu, salePriceTTC, salePriceHT, montant } }
const missingSalePrice = []; // PLU sans salePriceTTC (on utilisera pma en fallback)

for (const plu of pluSet) {
  const prevEntry = mapPrev[plu];
  const todayEntry = mapToday[plu];

  const prevCount = prevEntry ? toNum(prevEntry.counted || prevEntry.countedKg || 0) : 0;
  const todayCount = todayEntry ? toNum(todayEntry.counted || todayEntry.countedKg || 0) : 0;
  const poidsVendu = Math.max(0, prevCount - todayCount);

  // récupérer salePriceTTC depuis pricesToday (déjà rempli depuis stock_movements)
  let salePriceTTC = null;
  if (pricesToday[plu] && pricesToday[plu].salePriceTTC) {
    salePriceTTC = toNum(pricesToday[plu].salePriceTTC);
  }

  // convertir TTC -> HT (si présent)
  let salePriceHT = 0;
  if (salePriceTTC && salePriceTTC > 0) {
    salePriceHT = round2(salePriceTTC / (1 + TVA_RATE));
  } else {
    // fallback : utiliser buyPrice (pma) si salePriceTTC manquant
    if (pricesToday[plu] && pricesToday[plu].buyPrice) {
      salePriceHT = pricesToday[plu].buyPrice;
    } else {
      salePriceHT = 0; // aucun prix trouvé
      missingSalePrice.push(plu);
    }
  }

  const montantPlu = round2(poidsVendu * salePriceHT);
  caTheorique += montantPlu;

  caParPlu[plu] = {
    poidsVendu,
    salePriceTTC: salePriceTTC || null,
    salePriceHT: salePriceHT || null,
    montant: montantPlu
  };
}

caTheorique = round2(caTheorique);

// debug : log si nécessaire
if (Object.keys(caParPlu).length) {
  console.debug("caTheorique detail (par PLU):", caParPlu);
  if (missingSalePrice.length) console.warn("PLU sans salePriceTTC (fallback pma utilisé) :", missingSalePrice);
}

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
