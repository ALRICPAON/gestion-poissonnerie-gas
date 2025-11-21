/**************************************************
 * TRANSFORMATION.JS — Version 100% adaptée aux LOTS RÉELS
 * Auteur : ChatGPT pour Alric — 21/11/2025
 **************************************************/

import { app, db } from "../js/firebase-init.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  query, where, orderBy, serverTimestamp, Timestamp, limit
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { getAuth, onAuthStateChanged } from 
"https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

/* ---------------------------
   Utils
--------------------------- */
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const nz = v => v == null ? "" : String(v).trim();
const toNum = v => {
  const x = parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};
const fmtDate = ts => {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString("fr-FR") : "";
};
const fmtMoney = n =>
  Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const todayKey = () => {
  const d = new Date();
  return d.getFullYear().toString()
       + String(d.getMonth()+1).padStart(2,"0")
       + String(d.getDate()).padStart(2,"0");
};

const genLotId = () =>
  `T${todayKey()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;

/* ---------------------------
   DOM references
--------------------------- */
const el = {
  form: qs("#form-container"),
  histo: qs("#transfo-list"),
  popup: qs("#popup-f9"),
  popupBody: qs("#popup-f9 tbody"),
  popupSearch: qs("#f9-search"),
  popupClose: qs("#f9-close")
};

let UID = null;
let ARTICLES = [];
let F9_MODE = null;

/* ---------------------------
   Init
--------------------------- */
const auth = getAuth(app);
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  UID = user.uid;

  await loadArticles();
  renderForm();
  bindPopup();
  await loadHistory();
});

/* ---------------------------
   Load Articles (for F9)
--------------------------- */
async function loadArticles() {
  const snap = await getDocs(collection(db, "articles"));
  ARTICLES = [];
  snap.forEach(d => ARTICLES.push({ id: d.id, ...d.data() }));
  ARTICLES.sort((a,b)=> nz(a.designation).localeCompare(nz(b.designation)));
}

/* ---------------------------
   Render Form
--------------------------- */
function renderForm() {
  el.form.innerHTML = `
    <div class="card">
      <h2>Transformation simple (1 → 1)</h2>

      <label>Produit source</label>
      <div class="form-row">
        <input id="src-plu" class="input" placeholder="PLU source" style="width:130px">
        <input id="src-des" class="input" placeholder="Désignation source" disabled>
        <button id="src-f9" class="btn btn-muted">F9</button>
      </div>

      <label>Poids consommé (kg)</label>
      <input id="src-kg" class="input">

      <hr>

      <label>Produit résultat</label>
      <div class="form-row">
        <input id="dst-plu" class="input" placeholder="PLU résultat" style="width:130px">
        <input id="dst-des" class="input" placeholder="Désignation résultat" disabled>
        <button id="dst-f9" class="btn btn-muted">F9</button>
      </div>

      <label>Poids obtenu (kg)</label>
      <input id="dst-kg" class="input">

      <button id="btn-run" class="btn btn-primary" style="margin-top:10px;width:100%;">
        Valider la transformation
      </button>

      <div id="msg" style="margin-top:10px;"></div>
    </div>
  `;

  qs("#src-f9").onclick = () => openF9("src");
  qs("#dst-f9").onclick = () => openF9("dst");

  qs("#src-plu").onchange = () => fillFromPlu("src");
  qs("#dst-plu").onchange = () => fillFromPlu("dst");

  qs("#btn-run").onclick = runTransformation;
}

function setMsg(txt, type="info") {
  const c = {
    info: "#ccc", ok: "#52e16b",
    err: "#ff6868", warn: "#f1c04f"
  }[type] || "#ccc";
  qs("#msg").innerHTML = `<span style="color:${c}">${txt}</span>`;
}

/* ---------------------------
   F9 popup
--------------------------- */
function bindPopup() {
  el.popupClose.onclick = closeF9;
  el.popupSearch.oninput = renderF9;
  el.popup.onclick = e => { if (e.target === el.popup) closeF9(); };
}

function openF9(mode) {
  F9_MODE = mode;
  el.popupSearch.value = "";
  renderF9();
  el.popup.style.display = "flex";
}

function closeF9() {
  el.popup.style.display = "none";
  F9_MODE = null;
}

function renderF9() {
  const q = el.popupSearch.value.toLowerCase();
  const list = ARTICLES.filter(a =>
    String(a.PLU || "").toLowerCase().includes(q) ||
    String(a.Designation || "").toLowerCase().includes(q) ||
    String(a.NomLatin || "").toLowerCase().includes(q)
);


  el.popupBody.innerHTML = list.map(a => `
    <tr class="pick" data-plu="${a.plu}">
      <td>${a.PLU || ""}</td>
<td>${a.Designation || ""}</td>
<td>${a.NomLatin || ""}</td>
    </tr>
  `).join("");

  qsa(".pick").forEach(tr => {
    tr.onclick = () => {
      const plu = tr.dataset.plu;
      const art = ARTICLES.find(a => a.PLU == input.value);
      applyArticle(F9_MODE, art);
      closeF9();
    };
  });
}

function fillFromPlu(mode) {
  const input = qs(mode==="src"?"#src-plu":"#dst-plu");
  const art = ARTICLES.find(a => a.plu == input.value);
  if (art) applyArticle(mode, art);
}

function applyArticle(mode, art) {
  if (mode === "src") {
    qs("#src-plu").value = art.plu;
    qs("#src-des").value = art.Designation || "";
  } else {
    qs("#dst-plu").value = art.plu;
    qs("#dst-des").value = art.Designation || "";
  }
}

/* ---------------------------
   Load LOTS FIFO
--------------------------- */
async function loadLotsFIFO(plu) {
  const qLots = query(
    collection(db, "lots"),
    where("plu", "==", plu),
    where("closed", "==", false),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(qLots);
  const lots = [];
  snap.forEach(d => {
    const L = d.data();
    lots.push({
      id: d.id,
      ref: d.ref,
      plu: L.plu,
      designation: L.designation,
      poidsInitial: toNum(L.poidsInitial),
      poidsRestant: toNum(L.poidsRestant),
      prixAchatKg: toNum(L.prixAchatKg),
      lotId: L.lotId,
      fao: L.fao || "",
      zone: L.zone || "",
      sousZone: L.sousZone || "",
      nomLatin: L.nomLatin || "",
      dlc: L.dlc || null
    });
  });

  return lots.filter(l => l.poidsRestant > 0);
}

/* ---------------------------
   Consume FIFO
--------------------------- */
async function consumeFIFO(lots, needed) {
  let rest = needed;
  let totalCost = 0;
  const used = [];

  for (const lot of lots) {
    if (rest <= 0) break;

    const take = Math.min(rest, lot.poidsRestant);
    rest -= take;

    const newRest = lot.poidsRestant - take;
    totalCost += take * lot.prixAchatKg;

    await updateDoc(lot.ref, {
      poidsRestant: newRest,
      closed: newRest <= 0,
      updatedAt: serverTimestamp()
    });

    used.push({
      lot,
      takeKg: take
    });
  }

  if (rest > 0.001) throw new Error("Stock insuffisant.");

  return { used, totalCost };
}

/* ---------------------------
   Meta inheritance
--------------------------- */
function inheritMeta(used) {
  if (used.length === 0) return {};

  // majoritaire = plus gros takeKg
  const main = used.slice().sort((a,b)=> b.takeKg - a.takeKg)[0].lot;

  // dlc la plus proche si plusieurs
  const dlcs = used
    .map(u => u.lot.dlc)
    .filter(Boolean)
    .map(d => d.toDate ? d.toDate() : d)
    .sort((a,b)=> a-b);

  return {
    fao: main.fao,
    zone: main.zone,
    sousZone: main.sousZone,
    nomLatin: main.nomLatin,
    dlc: dlcs.length ? Timestamp.fromDate(dlcs[0]) : null
  };
}

/* ---------------------------
   Create NEW LOT (transformation)
--------------------------- */
async function createTransfoLot({
  plu, designation, poids, paFinal, meta, used
}) {
  const lotId = genLotId();

  await setDoc(doc(db, "lots", lotId), {
    source: "transformation",
    plu,
    designation,
    poidsInitial: poids,
    poidsRestant: poids,
    prixAchatKg: paFinal,
    lotId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closed: false,

    // meta 
    fao: meta.fao || "",
    zone: meta.zone || "",
    sousZone: meta.sousZone || "",
    nomLatin: meta.nomLatin || "",
    dlc: meta.dlc || null,

    // trace
    origineLots: used.map(u => ({
      lotId: u.lot.lotId,
      kgPris: u.takeKg,
      prixKg: u.lot.prixAchatKg
    }))
  });

  return lotId;
}

/* ---------------------------
   Save transformation log
--------------------------- */
async function saveHistory(t) {
  await addDoc(collection(db, "transformations"), {
    ...t,
    userId: UID,
    createdAt: serverTimestamp()
  });
}

/* ---------------------------
   Run Transformation
--------------------------- */
async function runTransformation() {
  setMsg("Traitement en cours…");

  const srcPlu = nz(qs("#src-plu").value);
  const srcKg  = toNum(qs("#src-kg").value);
  const dstPlu = nz(qs("#dst-plu").value);
  const dstKg  = toNum(qs("#dst-kg").value);
  const dstDes = nz(qs("#dst-des").value);

  if (!srcPlu || !dstPlu) return setMsg("PLU manquant", "err");
  if (srcKg <= 0 || dstKg <= 0) return setMsg("Poids invalides", "err");

  try {
    const lots = await loadLotsFIFO(srcPlu);
    if (!lots.length) return setMsg("Aucun lot ouvert pour ce PLU", "err");

    const { used, totalCost } = await consumeFIFO(lots, srcKg);
    const paFinal = totalCost / dstKg;

    const meta = inheritMeta(used);

    const newLotId = await createTransfoLot({
      plu: dstPlu,
      designation: dstDes,
      poids: dstKg,
      paFinal,
      meta,
      used
    });

    await saveHistory({
      type: "simple",
      sourcePlu: srcPlu,
      kgSource: srcKg,
      ciblePlu: dstPlu,
      cibleDesignation: dstDes,
      kgCible: dstKg,
      rendement: dstKg / srcKg,
      paCible: paFinal,
      coutSource: totalCost,
      lotCibleId: newLotId,
      lotsSource: used.map(u => ({
        lotId: u.lot.lotId,
        kgPris: u.takeKg,
        prixKg: u.lot.prixAchatKg
      }))
    });

    setMsg(`✔️ Transformation OK — Nouveau lot : ${newLotId} — PA ${paFinal.toFixed(2)} €/kg`, "ok");

    qs("#src-kg").value = "";
    qs("#dst-kg").value = "";

    await loadHistory();

  } catch (e) {
    console.error(e);
    setMsg("Erreur : " + e.message, "err");
  }
}

/* ---------------------------
   Load HISTORY
--------------------------- */
async function loadHistory() {
  const qH = query(
    collection(db, "transformations"),
    where("userId", "==", UID),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const snap = await getDocs(qH);
  if (snap.empty) {
    el.histo.innerHTML = `<tr><td colspan="6">Aucune transformation.</td></tr>`;
    return;
  }

  let html = "";
  snap.forEach(d => {
    const t = d.data();
    html += `
      <tr>
        <td>${fmtDate(t.createdAt)}</td>
        <td>${t.sourcePlu} (${toNum(t.kgSource).toFixed(2)}kg)</td>
        <td>${t.ciblePlu} (${toNum(t.kgCible).toFixed(2)}kg)</td>
        <td>${toNum(t.paCible).toFixed(2)} €/kg</td>
        <td>${t.lotCibleId}</td>
        <td><button class="btn btn-small btn-muted" data-id="${d.id}">Voir</button></td>
      </tr>
    `;
  });

  el.histo.innerHTML = html;

  qsa("[data-id]").forEach(btn => {
    btn.onclick = () => viewTransfo(btn.dataset.id);
  });
}

async function viewTransfo(id) {
  const ref = doc(db, "transformations", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const t = snap.data();
  const lines = [
    `📅 ${fmtDate(t.createdAt)}`,
    `Source : ${t.sourcePlu} (${toNum(t.kgSource)}kg)`,
    `Cible : ${t.ciblePlu} (${toNum(t.kgCible)}kg)`,
    `PA final : ${toNum(t.paCible).toFixed(2)} €/kg`,
    `Lot créé : ${t.lotCibleId}`,
    ``,
    `Lots utilisés :`,
    ...(t.lotsSource || []).map(l => `- ${l.lotId} : ${l.kgPris}kg × ${l.prixKg}€/kg`)
  ];

  alert(lines.join("\n"));
}
