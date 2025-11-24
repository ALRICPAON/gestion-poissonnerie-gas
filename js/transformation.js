/**************************************************
 * TRANSFORMATION.JS — Version LOTS RÉELS + RECETTES (n → 1)
 * Auteur : ChatGPT pour Alric — 24/11/2025
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
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0")
  );
};

const genLotId = () =>
  `T${todayKey()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

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
  bindPopup();

  qs("#type-transformation").onchange = renderForm;
  renderForm();

  await loadHistory();
});

/* ---------------------------
   Load Articles (for F9)
--------------------------- */
async function loadArticles() {
  const snap = await getDocs(collection(db, "articles"));
  ARTICLES = [];
  snap.forEach(d => ARTICLES.push({ id: d.id, ...d.data() }));
  ARTICLES.sort((a, b) =>
    nz(a.Designation).localeCompare(nz(b.Designation))
  );
}

/* ---------------------------
   MAIN FORM ROUTER
--------------------------- */
function renderForm() {
  const type = qs("#type-transformation").value;

  if (type === "simple") renderSimpleForm();
  else if (type === "recette") renderRecetteForm();
}

/* ============================================================
   PARTIE 1 — TRANSFORMATION SIMPLE (1 → 1)
   (inchangée, copiée EXACTEMENT comme tu l'avais)
============================================================ */

function renderSimpleForm() {
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

function setMsg(txt, type = "info") {
  const c = {
    info: "#ccc",
    ok: "#52e16b",
    err: "#ff6868",
    warn: "#f1c04f"
  }[type] || "#ccc";
  qs("#msg").innerHTML = `<span style="color:${c}">${txt}</span>`;
}

/* ============================================================
   PARTIE 2 — POPUP F9
============================================================ */

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

  el.popupBody.innerHTML = list
    .map(
      a => `
    <tr class="pick" data-plu="${a.PLU}">
      <td>${a.PLU}</td>
      <td>${a.Designation || ""}</td>
      <td>${a.NomLatin || ""}</td>
    </tr>`
    )
    .join("");

  qsa(".pick").forEach(tr => {
    tr.onclick = () => {
      const plu = tr.dataset.plu;

      const art = ARTICLES.find(a => String(a.PLU) === String(plu));
      if (!art) return;

      applyArticle(F9_MODE, art);
      closeF9();
    };
  });
}

function fillFromPlu(mode) {
  const input =
    mode === "src"
      ? qs("#src-plu")
      : mode === "dst"
      ? qs("#dst-plu")
      : qs("#recette-plu");

  const art = ARTICLES.find(a => String(a.PLU) === String(input.value));
  if (art) applyArticle(mode, art);
}

function applyArticle(mode, art) {
  if (!art) return;
  const plu = String(art.PLU || "");
  const des = String(art.Designation || "");

  // Transformation simple
  if (mode === "src") {
    qs("#src-plu").value = plu;
    qs("#src-des").value = des;
    return;
  }
  if (mode === "dst") {
    qs("#dst-plu").value = plu;
    qs("#dst-des").value = des;
    return;
  }

  // Recette : ligne d’ingrédient
  if (mode && mode.startsWith("ing-")) {
    const row = qs("#" + mode);
    row.querySelector(".ing-plu").value = plu;
    row.querySelector(".ing-des").value = des;
    return;
  }

  // Recette : produit final
  if (mode === "dst-recette") {
    qs("#recette-plu").value = plu;
    qs("#recette-des").value = des;
    return;
  }
}

/* ============================================================
   PARTIE 3 — LOAD LOTS FIFO
============================================================ */

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
      dlc: L.dlc || null,
      achatId: L.achatId || null,
      ligneId: L.ligneId || null,
      engin: L.engin || "",
      photo_url: L.photo_url || L.photo || null
    });
  });

  return lots.filter(l => l.poidsRestant > 0);
}

/* ============================================================
   PARTIE 4 — FIFO SIMPLE
============================================================ */

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

    await addDoc(collection(db, "stock_movements"), {
      lotId: lot.id,
      type: "transformation",
      sens: "sortie",
      poids: -take,
      poidsRestant: newRest,
      createdAt: serverTimestamp()
    });
  }

  if (rest > 0.001) throw new Error("Stock insuffisant.");

  return { used, totalCost };
}

/* ============================================================
   PARTIE 5 — META INHERIT
============================================================ */

function inheritMeta(used) {
  if (used.length === 0) return {};

  // 1️⃣ Lot majoritaire (inchangé)
  const main = used.slice().sort((a, b) => b.takeKg - a.takeKg)[0].lot;

  // 2️⃣ DLC la plus proche
  const dlcs = used
    .map(u => u.lot.dlc)
    .filter(Boolean)
    .map(d => (d.toDate ? d.toDate() : d))
    .sort((a, b) => a - b);

  // 3️⃣ 🔥 RÉCUPÉRATION DES PHOTOS SUR LOT + SUR LIGNE BL
  const allPhotos = [];

  for (const u of used) {
    const lot = u.lot;

    // photo dans le lot
    if (lot.photo_url) allPhotos.push(lot.photo_url);
    if (lot.photo) allPhotos.push(lot.photo);

    // photo dans la ligne d’achat (si achatId + ligneId)
    if (lot.achatId && lot.ligneId) {
      const lignePhoto = lot.lignePhoto || lot.photo_ligne; // sécurité si déjà chargée une fois
      if (lignePhoto) {
        allPhotos.push(lignePhoto);
      }
    }
  }

  const uniquePhotos = [...new Set(allPhotos.filter(Boolean))];

  // 4️⃣ 🔥 LISTES COMPLÈTES
  const allFAO = [...new Set(used.map(u => u.lot.fao).filter(Boolean))];
  const allZone = [...new Set(used.map(u => u.lot.zone).filter(Boolean))];
  const allSousZone = [...new Set(used.map(u => u.lot.sousZone).filter(Boolean))];
  const allEngins = [...new Set(used.map(u => u.lot.engin).filter(Boolean))];
  const allLatin = [...new Set(used.map(u => u.lot.nomLatin).filter(Boolean))];

  return {
    // Valeurs majoritaires
    fao: main.fao,
    zone: main.zone,
    sousZone: main.sousZone,
    nomLatin: main.nomLatin,
    dlc: dlcs.length ? Timestamp.fromDate(dlcs[0]) : null,
    engin: main.engin || "",
    photo_url: uniquePhotos[0] || null, // première photo pour affichage simple

    // 🔥 Listes complètes
    liste_fao: allFAO,
    liste_zone: allZone,
    liste_sousZone: allSousZone,
    liste_engin: allEngins,
    liste_nomLatin: allLatin,
    liste_photos: uniquePhotos
  };
}


/* ============================================================
   PARTIE 6 — LOT SIMPLE (inchangé)
============================================================ */

async function createTransfoLot({
  plu,
  designation,
  poids,
  paFinal,
  meta,
  used
}) {
  const lotId = genLotId();

  const first = used[0]?.lot || null;

  await setDoc(doc(db, "lots", lotId), {
    source: "transformation",
    lotId,
    plu,
    designation,
    poidsInitial: poids,
    poidsRestant: poids,
    prixAchatKg: paFinal,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closed: false,

    fao: meta.fao || "",
    zone: meta.zone || "",
    sousZone: meta.sousZone || "",
    nomLatin: meta.nomLatin || "",
    dlc: meta.dlc || null,
    engin: meta.engin || "",
    photo_url: meta.photo_url || null,

    achatId: first ? first.achatId : null,
    ligneId: first ? first.ligneId : null,

    origineLots: used.map(u => ({
      lotId: u.lot.lotId,
      kgPris: u.takeKg,
      prixKg: u.lot.prixAchatKg
    }))
  });

  await addDoc(collection(db, "stock_movements"), {
    lotId,
    type: "transformation",
    sens: "entrée",
    poids,
    poidsRestant: poids,
    createdAt: serverTimestamp()
  });

  return lotId;
}

/* ============================================================
   PARTIE 7 — HISTORIQUE (simple + recettes)
============================================================ */

async function saveHistory(t) {
  await addDoc(collection(db, "transformations"), {
    ...t,
    userId: UID,
    createdAt: serverTimestamp()
  });
}

/* ============================================================
   PARTIE 8 — TRANSFORMATION SIMPLE (inchangé)
============================================================ */

async function runTransformation() {
  setMsg("Traitement en cours…");

  const srcPlu = nz(qs("#src-plu").value);
  const srcKg = toNum(qs("#src-kg").value);
  const dstPlu = nz(qs("#dst-plu").value);
  const dstKg = toNum(qs("#dst-kg").value);
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

    setMsg(
      `✔️ Transformation OK — Nouveau lot : ${newLotId} — PA ${paFinal.toFixed(
        2
      )} €/kg`,
      "ok"
    );

    qs("#src-kg").value = "";
    qs("#dst-kg").value = "";

    await loadHistory();
  } catch (e) {
    console.error(e);
    setMsg("Erreur : " + e.message, "err");
  }
}

/* ============================================================
   PARTIE 9 — RECETTE (n → 1)
============================================================ */

function renderRecetteForm() {
  el.form.innerHTML = `
    <div class="card">
      <h2>Recette (n → 1)</h2>

      <h3>Ingrédients</h3>
      <table class="table" id="recette-ingredients">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Désignation</th>
            <th>Poids (kg)</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>

      <button id="btn-add-ing" class="btn btn-muted" style="margin-top:5px;">+ Ajouter un ingrédient</button>

      <hr>

      <h3>Produit final</h3>

      <div class="form-row">
        <input id="recette-plu" class="input" placeholder="PLU final" style="width:130px">
        <input id="recette-des" class="input" placeholder="Désignation finale" disabled>
        <button id="recette-f9" class="btn btn-muted">F9</button>
      </div>

      <label>Poids final obtenu (kg)</label>
      <input id="recette-kg-final" class="input">

      <button id="btn-run-recette" class="btn btn-primary" style="margin-top:10px;width:100%;">
        Valider la recette
      </button>

      <div id="msg" style="margin-top:10px;"></div>
    </div>
  `;

  qs("#btn-add-ing").onclick = addIngredientRow;
  qs("#recette-f9").onclick = () => openF9("dst-recette");
  qs("#recette-plu").onchange = () => fillFromPlu("dst-recette");
  qs("#btn-run-recette").onclick = runTransformationRecette;
}

function addIngredientRow() {
  const tbody = qs("#recette-ingredients tbody");

  const rowId = "ing-" + Math.random().toString(36).substring(2, 8);

  const html = `
    <tr id="${rowId}">
      <td><input class="input ing-plu" placeholder="PLU"></td>
      <td><input class="input ing-des" placeholder="Désignation" disabled></td>
      <td><input class="input ing-kg" placeholder="kg"></td>
      <td>
        <button class="btn btn-muted ing-f9">F9</button>
        <button class="btn btn-red ing-del">X</button>
      </td>
    </tr>
  `;

  tbody.insertAdjacentHTML("beforeend", html);

  const row = qs("#" + rowId);

  row.querySelector(".ing-f9").onclick = () => {
    F9_MODE = rowId;
    openF9(rowId);
  };

  row.querySelector(".ing-del").onclick = () => row.remove();

  row.querySelector(".ing-plu").onchange = () => fillIngredientRow(rowId);
}

function fillIngredientRow(rowId) {
  const row = qs("#" + rowId);
  const plu = nz(row.querySelector(".ing-plu").value);

  const art = ARTICLES.find(a => String(a.PLU) === String(plu));

  if (art) {
    row.querySelector(".ing-des").value = art.Designation || "";
  }
}

async function consumeMultipleIngredients(ingredients) {
  const usedAll = [];
  let totalCost = 0;

  for (const ing of ingredients) {
    const lots = await loadLotsFIFO(ing.plu);
    if (!lots.length) throw new Error(`Pas de stock pour le PLU ${ing.plu}`);

    const { used, totalCost: cost } = await consumeFIFO(lots, ing.kg);

    totalCost += cost;

    usedAll.push({
      plu: ing.plu,
      designation: ing.des,
      kg: ing.kg,
      used
    });
  }

  return { usedAll, totalCost };
}

async function createRecipeLot(plu, des, poids, paFinal, usedAll) {
  const flat = usedAll.flatMap(u => u.used);
  const meta = inheritMeta(flat);
  const first = flat[0]?.lot || null;

  const lotId = genLotId();

  await setDoc(doc(db, "lots", lotId), {
  source: "recette",
  lotId,
  plu,
  designation: des,
  poidsInitial: poids,
  poidsRestant: poids,
  prixAchatKg: paFinal,

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  closed: false,

  // majoritaire
  fao: meta.fao,
  zone: meta.zone,
  sousZone: meta.sousZone,
  nomLatin: meta.nomLatin,
  dlc: meta.dlc,
  engin: meta.engin,
  photo_url: meta.photo_url,

  // 🔥 nouvelles listes complètes
  liste_fao: meta.liste_fao,
  liste_zone: meta.liste_zone,
  liste_sousZone: meta.liste_sousZone,
  liste_engin: meta.liste_engin,
  liste_nomLatin: meta.liste_nomLatin,
  liste_photos: meta.liste_photos,

  achatId: first ? first.achatId : null,
  ligneId: first ? first.ligneId : null,

  ingredients: usedAll
});

  return lotId;
}

async function runTransformationRecette() {
  setMsg("Traitement recette…");

  const rows = qsa("#recette-ingredients tbody tr");

  const ingredients = rows
    .map(r => ({
      plu: nz(r.querySelector(".ing-plu").value),
      des: nz(r.querySelector(".ing-des").value),
      kg: toNum(r.querySelector(".ing-kg").value)
    }))
    .filter(i => i.plu && i.kg > 0);

  if (!ingredients.length) return setMsg("Aucun ingrédient", "err");

  const dstPlu = nz(qs("#recette-plu").value);
  const dstDes = nz(qs("#recette-des").value);
  const dstKg = toNum(qs("#recette-kg-final").value);

  if (!dstPlu || dstKg <= 0) return setMsg("Données incomplètes", "err");

  try {
    const { usedAll, totalCost } = await consumeMultipleIngredients(
      ingredients
    );
    const paFinal = totalCost / dstKg;

    const newLotId = await createRecipeLot(
      dstPlu,
      dstDes,
      dstKg,
      paFinal,
      usedAll
    );

    await saveHistory({
      type: "recette",
      ingredients: usedAll,
      totalCost,
      paCible: paFinal,
      lotCibleId: newLotId,
      kgCible: dstKg
    });

    setMsg(
      `✔️ Recette OK — Nouveau lot : ${newLotId} — PA ${paFinal.toFixed(
        2
      )} €/kg`,
      "ok"
    );

    await loadHistory();
  } catch (e) {
    console.error(e);
    setMsg("Erreur : " + e.message, "err");
  }
}

/* ============================================================
   PARTIE 10 — HISTORIQUE
============================================================ */

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

    const type =
      t.type === "simple"
        ? "Simple (1→1)"
        : t.type === "recette"
        ? "Recette (n→1)"
        : t.type;

    const source =
      t.type === "simple"
        ? `${t.sourcePlu} (${toNum(t.kgSource).toFixed(2)}kg)`
        : `${(t.ingredients || [])
            .map(i => `${i.plu} (${i.kg}kg)`)
            .join(", ")}`;

    html += `
      <tr>
        <td>${fmtDate(t.createdAt)}</td>
        <td>${type}</td>
        <td>${source}</td>
        <td>${t.ciblePlu || t.lotCibleId}</td>
        <td>${toNum(t.paCible).toFixed(2)} €/kg</td>
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

  let lines = [];

  lines.push(`📅 ${fmtDate(t.createdAt)}`);

  if (t.type === "simple") {
    lines.push(
      `Source : ${t.sourcePlu} (${toNum(t.kgSource)}kg)`,
      `Cible : ${t.ciblePlu} (${toNum(t.kgCible)}kg)`
    );
  }

  if (t.type === "recette") {
    lines.push(`Ingrédients :`);
    (t.ingredients || []).forEach(i => {
      lines.push(`- ${i.plu} : ${i.kg}kg`);
    });
  }

  lines.push(
    `PA final : ${toNum(t.paCible).toFixed(2)} €/kg`,
    `Lot créé : ${t.lotCibleId}`,
    ``,
    `Lots utilisés :`
  );

  const used =
    t.type === "simple"
      ? t.lotsSource || []
      : t.ingredients?.flatMap(i => i.used) || [];

  used.forEach(l =>
    lines.push(
      `- ${l.lot.lotId} : ${l.takeKg}kg × ${l.lot.prixAchatKg}€/kg`
    )
  );

  alert(lines.join("\n"));
}
