/**************************************************
 * TRANSFORMATION.JS — FIFO complet basé sur lots
 * Compatible avec transformation.html (fourni)
 * Auteur: ChatGPT pour Alric — 21/11/2025
 **************************************************/

import { app, db } from "../js/firebase-init.js";
import {
  collection, collectionGroup,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, where, orderBy, limit,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

/* ---------------------------
  Utils
--------------------------- */
const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const nz = (v) => (v == null ? "" : String(v).trim());
const toNum = (v) => {
  const x = parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};
const fmtMoney = (n) =>
  Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const fmtDate = (ts) => {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleDateString("fr-FR");
  } catch { return ""; }
};
const todayKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da= String(d.getDate()).padStart(2,"0");
  return `${y}${m}${da}`;
};
const genLotId = () => `T${todayKey()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

/* ---------------------------
  DOM refs
--------------------------- */
const el = {
  formContainer: qs("#form-container"),
  typeSelect: qs("#type-transformation"),
  transfoList: qs("#transfo-list"),

  popup: qs("#popup-f9"),
  popupBody: qs("#popup-f9 tbody"),
  popupSearch: qs("#f9-search"),
  popupClose: qs("#f9-close"),
};

let UID = null;

// caches
let STOCK = [];     // docs stock
let ARTICLES = [];  // docs articles
let F9_MODE = null; // "source" | "target"
let onPickSource = null;
let onPickTarget = null;

/* ---------------------------
  Boot
--------------------------- */
const auth = getAuth(app);
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  UID = user.uid;

  await loadStock();
  await loadArticles();
  renderFormSimple();
  await loadHistory();
  bindPopup();
});

/* ---------------------------
  Loaders
--------------------------- */

// Stock résumé par PLU
async function loadStock() {
  const snap = await getDocs(collection(db, "stock"));
  STOCK = [];
  snap.forEach(d => STOCK.push({ id: d.id, ...d.data() }));

  // tri alpha
  STOCK.sort((a,b)=> nz(a.designation).localeCompare(nz(b.designation)));
}

// Articles (pour popup F9)
async function loadArticles() {
  const snap = await getDocs(collection(db, "articles"));
  ARTICLES = [];
  snap.forEach(d => ARTICLES.push({ id: d.id, ...d.data() }));
  ARTICLES.sort((a,b)=> nz(a.designation).localeCompare(nz(b.designation)));
}

/* ---------------------------
  Form render (simple 1→1)
--------------------------- */
function renderFormSimple() {
  if (!el.formContainer) return;

  el.formContainer.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <h2 style="margin-top:0;">Transformation simple (1 → 1)</h2>

      <div class="form-row">
        <label>Produit source</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="src-plu" class="input" placeholder="PLU source" style="width:140px;">
          <input id="src-des" class="input" placeholder="Désignation source" style="flex:1;" disabled>
          <button id="src-f9" class="btn btn-muted">F9</button>
        </div>
        <small id="src-info" style="opacity:.7;"></small>
      </div>

      <div class="form-row">
        <label>Poids consommé (kg)</label>
        <input id="src-kg" class="input" placeholder="ex: 3,5">
      </div>

      <hr style="margin:14px 0;opacity:.2;">

      <div class="form-row">
        <label>Produit résultat</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="dst-plu" class="input" placeholder="PLU cible" style="width:140px;">
          <input id="dst-des" class="input" placeholder="Désignation cible" style="flex:1;" disabled>
          <button id="dst-f9" class="btn btn-muted">F9</button>
        </div>
        <small id="dst-info" style="opacity:.7;"></small>
      </div>

      <div class="form-row">
        <label>Poids obtenu (kg)</label>
        <input id="dst-kg" class="input" placeholder="ex: 2,1">
      </div>

      <div class="form-row" style="margin-top:10px;">
        <button id="btn-run-transfo" class="btn btn-primary" style="width:100%;">
          ✅ Valider la transformation
        </button>
      </div>

      <div id="transfo-msg" style="margin-top:8px;"></div>
    </div>
  `;

  // bind F9 buttons
  qs("#src-f9").addEventListener("click", () => openF9("source"));
  qs("#dst-f9").addEventListener("click", () => openF9("target"));

  // when user types plu manually
  qs("#src-plu").addEventListener("change", () => fillFromPlu("source"));
  qs("#dst-plu").addEventListener("change", () => fillFromPlu("target"));

  qs("#btn-run-transfo").addEventListener("click", runTransformationSimple);
}

function fillFromPlu(mode) {
  const plu = nz(qs(mode === "source" ? "#src-plu" : "#dst-plu").value);
  if (!plu) return;

  const art = ARTICLES.find(a => String(a.plu) === plu || a.id === plu);
  if (!art) {
    setMsg("⚠️ PLU inconnu dans Articles.", "warn");
    return;
  }
  applyPickedArticle(mode, art);
}

function applyPickedArticle(mode, art) {
  if (mode === "source") {
    qs("#src-plu").value = art.plu || art.id || "";
    qs("#src-des").value = art.designation || "";
    qs("#src-info").textContent = art.nomLatin ? `Nom latin : ${art.nomLatin}` : "";
    // petite aide stock
    const st = STOCK.find(s => String(s.plu) === String(art.plu));
    if (st?.resteKg != null) {
      qs("#src-info").textContent += ` — Stock: ${toNum(st.resteKg).toFixed(2)} kg`;
    }
  } else {
    qs("#dst-plu").value = art.plu || art.id || "";
    qs("#dst-des").value = art.designation || "";
    qs("#dst-info").textContent = art.nomLatin ? `Nom latin : ${art.nomLatin}` : "";
  }
}

/* ---------------------------
  Popup F9
--------------------------- */
function bindPopup() {
  if (!el.popup) return;

  el.popupClose.addEventListener("click", closeF9);
  el.popupSearch.addEventListener("input", renderF9List);

  el.popup.addEventListener("click", (e) => {
    if (e.target === el.popup) closeF9();
  });
}

function openF9(mode) {
  F9_MODE = mode; // source | target
  el.popupSearch.value = "";
  renderF9List();
  el.popup.style.display = "flex";
}

function closeF9() {
  el.popup.style.display = "none";
  F9_MODE = null;
}

function renderF9List() {
  const q = nz(el.popupSearch.value).toLowerCase();
  const list = ARTICLES.filter(a => {
    const plu = String(a.plu || a.id || "").toLowerCase();
    const des = nz(a.designation).toLowerCase();
    const latin = nz(a.nomLatin).toLowerCase();
    return !q || plu.includes(q) || des.includes(q) || latin.includes(q);
  });

  el.popupBody.innerHTML = list.map(a => `
    <tr class="row-pick" data-plu="${a.plu || a.id}">
      <td>${a.plu || ""}</td>
      <td>${a.designation || ""}</td>
      <td>${a.nomLatin || ""}</td>
    </tr>
  `).join("");

  qsa(".row-pick").forEach(tr => {
    tr.addEventListener("click", () => {
      const plu = tr.dataset.plu;
      const art = ARTICLES.find(x => String(x.plu || x.id) === String(plu));
      if (art) applyPickedArticle(F9_MODE, art);
      closeF9();
    });
  });
}

/* ---------------------------
  Core — FIFO lots
--------------------------- */

// Retourne lots ouverts FIFO pour un PLU
async function loadOpenLotsForPlu(plu) {
  // On récupère toutes les lignes d’achats (collectionGroup "lignes")
  // Filtre sur plu et closed=false
  const lotsQ = query(
    collectionGroup(db, "lignes"),
    where("plu", "==", isNaN(plu) ? plu : Number(plu)),
    where("closed", "==", false),
    orderBy("createdAt", "asc"),
    limit(200)
  );

  const snap = await getDocs(lotsQ);
  const lots = [];
  snap.forEach(d => {
    const data = d.data();
    lots.push({
      id: d.id,
      ref: d.ref,
      ...data
    });
  });

  // calcul resteKg si absent
  lots.forEach(l => {
    const total = toNum(l.poidsTotalKg ?? l.poidsKg ?? l.poids ?? 0);
    const consumed = toNum(l.poidsConsumeeKg ?? l.kgConsomme ?? 0);
    const resteField = l.resteKg ?? l.restantKg;
    const reste = resteField != null ? toNum(resteField) : Math.max(0, total - consumed);
    l._resteKg = reste;
    l._totalKg = total;
    l._prixKg = toNum(l.prixKg ?? l.pa ?? 0);
  });

  // on garde seulement ceux avec reste>0
  return lots.filter(l => l._resteKg > 0.0001);
}

// consomme FIFO
async function consumeLotsFIFO(lots, neededKg) {
  let remaining = neededKg;
  let totalCost = 0;
  const usedLots = [];

  for (const lot of lots) {
    if (remaining <= 0) break;

    const take = Math.min(lot._resteKg, remaining);
    remaining -= take;

    totalCost += take * lot._prixKg;
    usedLots.push({ lot, takeKg: take });

    const newConsumed = toNum(lot.poidsConsumeeKg ?? 0) + take;
    const newReste = Math.max(0, lot._totalKg - newConsumed);

    await updateDoc(lot.ref, {
      poidsConsumeeKg: newConsumed,
      resteKg: newReste,
      closed: newReste <= 0.0001,
      updatedAt: serverTimestamp()
    });
  }

  if (remaining > 0.001) {
    throw new Error(`Stock insuffisant. Manque ${remaining.toFixed(2)} kg`);
  }

  return { totalCost, usedLots };
}

/* ---------------------------
  Create new lot (achats/TRANSFO + transformations log)
--------------------------- */
async function ensureDailyTransfoAchat() {
  const achatId = `TRANSFO_${todayKey()}`;
  const achatRef = doc(db, "achats", achatId);
  const snap = await getDoc(achatRef);

  if (!snap.exists()) {
    await setDoc(achatRef, {
      fournisseurCode: "TRANSFO",
      fournisseurNom: "TRANSFORMATIONS",
      dateBL: Timestamp.fromDate(new Date()),
      createdAt: serverTimestamp(),
      closed: false,
      type: "transformation",
      userId: UID
    }, { merge: true });
  }
  return achatRef;
}

async function createTransformedLot({
  dstPlu, dstDes, dstKg, paFinal, meta, usedLots
}) {
  const achatRef = await ensureDailyTransfoAchat();
  const lignesCol = collection(achatRef, "lignes");

  const lotId = genLotId();

  const newLine = {
    plu: isNaN(dstPlu) ? dstPlu : Number(dstPlu),
    designation: dstDes,
    poidsTotalKg: dstKg,
    prixKg: paFinal,
    lotId,
    type: "transformation",
    origineLotIds: usedLots.map(u => u.lot.lotId || u.lot.id),
    origineRefs: usedLots.map(u => u.lot.ref.path),
    createdAt: serverTimestamp(),
    closed: false,
    qr_url: "",

    // meta héritées
    fao: meta.fao || "",
    zone: meta.zone || "",
    souszone: meta.souszone || "",
    engin: meta.engin || "",
    nomLatin: meta.nomLatin || "",
    dlc: meta.dlc || null
  };

  const lineRef = await addDoc(lignesCol, newLine);
  return { lotId, lineRef };
}

/* ---------------------------
  Rebuild stock résumé pour un PLU
--------------------------- */
async function recomputeStockForPlu(plu) {
  const lots = await loadOpenLotsForPlu(plu);
  let totalKg = 0;
  let totalCost = 0;
  let designation = "";

  for (const l of lots) {
    totalKg += l._resteKg;
    totalCost += l._resteKg * l._prixKg;
    if (!designation) designation = l.designation || "";
  }
  const pa = totalKg > 0 ? totalCost / totalKg : 0;

  // On garde PV / marge existants si déjà en stock
  const stockDocId = String(plu);
  const stockRef = doc(db, "stock", stockDocId);
  const oldSnap = await getDoc(stockRef);
  const old = oldSnap.exists() ? oldSnap.data() : {};

  await setDoc(stockRef, {
    plu: isNaN(plu) ? plu : Number(plu),
    designation: designation || old.designation || "",
    resteKg: totalKg,
    pa: pa,
    pv: old.pv ?? null,
    marge: old.marge ?? null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/* ---------------------------
  Meta héritage (majoritaire)
--------------------------- */
function computeInheritedMeta(usedLots) {
  // majoritaire = lot où on a pris le plus de kg
  const majority = usedLots.slice().sort((a,b)=> b.takeKg - a.takeKg)[0]?.lot || {};
  const meta = {
    fao: majority.fao || "",
    zone: majority.zone || majority.faoZone || "",
    souszone: majority.souszone || majority.faoSousZone || "",
    engin: majority.engin || "",
    nomLatin: majority.nomLatin || "",
    dlc: majority.dlc || null
  };

  // DLC la plus proche (si dispo) pour sécurité
  const dlcs = usedLots
    .map(u => u.lot.dlc)
    .filter(Boolean)
    .map(d => (d.toDate ? d.toDate() : d))
    .sort((a,b)=> a-b);

  if (dlcs.length) meta.dlc = Timestamp.fromDate(dlcs[0]);

  return meta;
}

/* ---------------------------
  Run transformation simple
--------------------------- */
async function runTransformationSimple() {
  clearMsg();

  const srcPlu = nz(qs("#src-plu").value);
  const srcDes = nz(qs("#src-des").value);
  const srcKg  = toNum(qs("#src-kg").value);

  const dstPlu = nz(qs("#dst-plu").value);
  const dstDes = nz(qs("#dst-des").value);
  const dstKg  = toNum(qs("#dst-kg").value);

  if (!srcPlu || !dstPlu) return setMsg("⚠️ Choisis un PLU source et un PLU résultat.", "warn");
  if (srcKg <= 0 || dstKg <= 0) return setMsg("⚠️ Poids invalides.", "warn");

  try {
    setMsg("⏳ Chargement des lots FIFO…");

    const lots = await loadOpenLotsForPlu(srcPlu);
    if (!lots.length) throw new Error("Aucun lot ouvert pour ce PLU source.");

    const { totalCost, usedLots } = await consumeLotsFIFO(lots, srcKg);

    const paFinal = totalCost / dstKg;

    const meta = computeInheritedMeta(usedLots);

    const { lotId } = await createTransformedLot({
      dstPlu, dstDes, dstKg, paFinal, meta, usedLots
    });

    // log transformation
    await addDoc(collection(db, "transformations"), {
      userId: UID,
      type: "simple",
      sourcePlu: isNaN(srcPlu) ? srcPlu : Number(srcPlu),
      sourceDesignation: srcDes,
      kgSource: srcKg,
      ciblePlu: isNaN(dstPlu) ? dstPlu : Number(dstPlu),
      cibleDesignation: dstDes,
      kgCible: dstKg,
      rendement: dstKg / srcKg,
      coutSource: totalCost,
      paCible: paFinal,
      lotCibleId: lotId,
      lotsSource: usedLots.map(u => ({
        lotId: u.lot.lotId || u.lot.id,
        kgPris: u.takeKg,
        prixKg: u.lot._prixKg
      })),
      createdAt: serverTimestamp()
    });

    // rebuild stock résumé
    setMsg("⏳ Mise à jour stock…");
    await recomputeStockForPlu(srcPlu);
    await recomputeStockForPlu(dstPlu);

    setMsg(`✅ Transformation OK. PA final: ${paFinal.toFixed(2)} €/kg — Lot créé: ${lotId}`, "ok");

    // reset form
    qs("#src-kg").value = "";
    qs("#dst-kg").value = "";

    // refresh
    await loadStock();
    await loadHistory();

  } catch (e) {
    console.error(e);
    setMsg("❌ " + (e.message || "Erreur inconnue"), "err");
  }
}

/* ---------------------------
  History
--------------------------- */
async function loadHistory() {
  if (!el.transfoList) return;

  const qHist = query(
    collection(db, "transformations"),
    where("userId", "==", UID),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const snap = await getDocs(qHist);
  if (snap.empty) {
    el.transfoList.innerHTML = `<tr><td colspan="6">Aucune transformation.</td></tr>`;
    return;
  }

  let html = "";
  snap.forEach(d => {
    const t = d.data();
    html += `
      <tr>
        <td>${fmtDate(t.createdAt)}</td>
        <td>${t.type || "simple"}</td>
        <td>${t.sourcePlu || ""} — ${t.sourceDesignation || ""} (${toNum(t.kgSource).toFixed(2)}kg)</td>
        <td>${t.ciblePlu || ""} — ${t.cibleDesignation || ""} (${toNum(t.kgCible).toFixed(2)}kg)</td>
        <td>${fmtMoney(t.coutSource)} / ${toNum(t.kgCible).toFixed(2)}kg → ${toNum(t.paCible).toFixed(2)} €/kg</td>
        <td>
          <button class="btn btn-muted btn-small" data-id="${d.id}" data-action="view">Voir</button>
        </td>
      </tr>
    `;
  });

  el.transfoList.innerHTML = html;

  qsa("[data-action='view']").forEach(btn => {
    btn.addEventListener("click", () => viewTransfo(btn.dataset.id));
  });
}

async function viewTransfo(id) {
  const ref = doc(db, "transformations", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const t = snap.data();
  const detail = [
    `📅 ${fmtDate(t.createdAt)}`,
    `Source: ${t.sourcePlu} — ${t.sourceDesignation} (${toNum(t.kgSource).toFixed(2)} kg)`,
    `Résultat: ${t.ciblePlu} — ${t.cibleDesignation} (${toNum(t.kgCible).toFixed(2)} kg)`,
    `Rendement: ${(toNum(t.rendement)*100).toFixed(1)} %`,
    `Coût source: ${fmtMoney(t.coutSource)}`,
    `PA final: ${toNum(t.paCible).toFixed(2)} €/kg`,
    `Lot créé: ${t.lotCibleId}`,
    ``,
    `Lots consommés:`,
    ...(t.lotsSource || []).map(l => `- ${l.lotId} : ${toNum(l.kgPris).toFixed(2)} kg × ${toNum(l.prixKg).toFixed(2)} €/kg`)
  ].join("\n");

  alert(detail);
}

/* ---------------------------
  Message UI
--------------------------- */
function setMsg(txt, type="info") {
  const box = qs("#transfo-msg");
  if (!box) return;
  const c = {
    info: "color:#bbb;",
    ok: "color:#64d86b;",
    warn: "color:#f3b94d;",
    err: "color:#ff6b6b;"
  }[type] || "color:#bbb;";
  box.innerHTML = `<div style="${c}">${txt}</div>`;
}
function clearMsg(){ setMsg(""); }
