/**************************************************
 * PLATEAUX.JS — Module complet Plateaux
 * Auteur : ChatGPT pour Alric — 24/11/2025
 **************************************************/

import { app, db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
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
const fmtMoney = n =>
  Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/* ---------------------------
   DOM refs
--------------------------- */
const el = {
  form: qs("#form-container"),
  list: qs("#plateaux-list"),

  popup: qs("#popup-f9"),
  popupBody: qs("#popup-f9 tbody"),
  popupSearch: qs("#f9-search"),
  popupClose: qs("#f9-close"),
};

let UID = null;
let ARTICLES = [];
let F9_MODE = null;     // "plateau" ou "ing-xxxx"
let EDIT_ID = null;

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

  renderForm();      // création
  await loadPlateaux();
});

/* ---------------------------
   Load articles (F9)
--------------------------- */
async function loadArticles() {
  const snap = await getDocs(collection(db, "articles"));
  ARTICLES = [];
  snap.forEach(d => ARTICLES.push({ id: d.id, ...d.data() }));
  ARTICLES.sort((a,b)=> nz(a.Designation).localeCompare(nz(b.Designation)));
}

/* ---------------------------
   Form (Create/Edit)
--------------------------- */
function renderForm(data = null) {
  EDIT_ID = data?.id || null;

  el.form.innerHTML = `
    <div class="card">
      <h2>${EDIT_ID ? "Modifier un plateau" : "Créer un plateau"}</h2>

      <label>PLU du plateau</label>
      <div class="form-row">
        <input id="plateau-plu" class="input" placeholder="PLU plateau..." style="width:120px;">
        <input id="plateau-des" class="input" placeholder="Désignation auto" disabled>
        <input id="plateau-pv" class="input" placeholder="PV TTC" style="width:120px;">
        <button id="plateau-f9" class="btn btn-muted">F9</button>
      </div>

      <hr>

      <h3>Composition du plateau</h3>

      <table class="table" id="plateau-compos">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Désignation</th>
            <th>Quantité</th>
            <th>PA unité</th>
            <th>Coût</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>

      <button id="btn-add-comp" class="btn btn-muted" style="margin-top:5px;">+ Ajouter un produit</button>

      <hr>

      <h3>Prix de revient & marge</h3>
      <p>Prix de revient : <strong id="plateau-pr">0.00 €</strong></p>
      <p>Marge théorique : <strong id="plateau-marge">0 %</strong></p>

      <button id="btn-save-plateau" class="btn btn-primary" style="margin-top:10px;width:100%;">
        ${EDIT_ID ? "Enregistrer les modifications" : "Créer le plateau"}
      </button>

      ${EDIT_ID ? `
        <button id="btn-cancel-edit" class="btn btn-muted" style="margin-top:6px;width:100%;">
          Annuler l'édition
        </button>` : ""}

      <div id="msg" style="margin-top:10px;"></div>
    </div>
  `;

  // events PLU plateau
  qs("#plateau-f9").onclick = () => openF9("plateau");
  qs("#plateau-plu").onchange = onPlateauPluChange;

  // btn add composants
  qs("#btn-add-comp").onclick = addCompRow;

  // save plateau
  qs("#btn-save-plateau").onclick = savePlateau;

  if (EDIT_ID) {
    qs("#btn-cancel-edit").onclick = () => {
      renderForm(null);
    };
  }

  // pré-remplissage si mode edit
  if (data) {
    qs("#plateau-plu").value = data.plu || "";
    onPlateauPluChange();

    // inject composants
    (data.composants || []).forEach(c => addCompRow(c));

    // recalcul PR
    calcTotalPR();
  } else {
    addCompRow(); // 1 ligne par défaut
  }
}

function setMsg(txt, type="info") {
  const c = { info:"#ccc", ok:"#52e16b", err:"#ff6868", warn:"#f1c04f" }[type] || "#ccc";
  qs("#msg").innerHTML = `<span style="color:${c}">${txt}</span>`;
}

function onPlateauPluChange() {
  const plu = nz(qs("#plateau-plu").value);
  const art = ARTICLES.find(a => String(a.PLU) === String(plu));

  if (!art) {
    qs("#plateau-des").value = "";
    qs("#plateau-pv").value = "";
    calcTotalPR();
    return;
  }

  qs("#plateau-des").value = art.Designation || "";
  // essaye plusieurs champs possibles selon ta base
  qs("#plateau-pv").value =
    art.PVTTC_Choisi ?? art.PVTTC ?? art.PV_TTC ?? art.PV ?? "";
  calcTotalPR();
}

/* ---------------------------
   Ajout ligne composant
--------------------------- */
function addCompRow(prefill = null) {
  const tbody = qs("#plateau-compos tbody");
  const rowId = "ing-" + Math.random().toString(36).substring(2, 8);

  tbody.insertAdjacentHTML("beforeend", `
    <tr id="${rowId}" class="comp-row">
      <td><input class="input comp-plu" placeholder="PLU"></td>
      <td><input class="input comp-des" placeholder="Désignation" disabled></td>
      <td><input class="input comp-qty" placeholder="Quantité"></td>
      <td><input class="input comp-pa" placeholder="PA/kg ou PA/pièce"></td>
      <td><span class="comp-cost">0.00 €</span></td>
      <td>
        <button class="btn btn-muted comp-f9">F9</button>
        <button class="btn btn-red comp-del">X</button>
      </td>
    </tr>
  `);

  const row = qs("#"+rowId);
  bindCompRowEvents(row);

  // préfill edit
  if (prefill) {
    row.querySelector(".comp-plu").value = prefill.plu || "";
    row.querySelector(".comp-des").value = prefill.des || "";
    row.querySelector(".comp-qty").value = prefill.qty ?? "";
    row.querySelector(".comp-pa").value  = prefill.pa  ?? "";
    recalcRow(row);
  }
}

function bindCompRowEvents(row){
  const plu = row.querySelector(".comp-plu");
  const qty = row.querySelector(".comp-qty");
  const pa  = row.querySelector(".comp-pa");
  const des = row.querySelector(".comp-des");

  row.querySelector(".comp-f9").onclick = () => openF9(row.id);

  plu.onchange = () => {
    const art = ARTICLES.find(a => String(a.PLU) === String(plu.value));
    des.value = art ? (art.Designation || "") : "";
    recalcRow(row);
  };

  qty.oninput = () => recalcRow(row);
  pa.oninput  = () => recalcRow(row);

  row.querySelector(".comp-del").onclick = () => {
    row.remove();
    calcTotalPR();
  };
}

function recalcRow(row){
  const qty = toNum(row.querySelector(".comp-qty").value);
  const pa  = toNum(row.querySelector(".comp-pa").value);
  const cost = qty * pa;

  row.querySelector(".comp-cost").textContent = cost.toFixed(2)+" €";
  calcTotalPR();
}

/* ---------------------------
   PR total + marge
--------------------------- */
function calcTotalPR(){
  let total = 0;
  qsa(".comp-cost").forEach(span => {
    const v = toNum(span.textContent.replace("€",""));
    total += v;
  });

  qs("#plateau-pr").textContent = total.toFixed(2)+" €";

  const pv = toNum(qs("#plateau-pv").value);
  if (pv > 0) {
    const marge = ((pv - total)/pv)*100;
    qs("#plateau-marge").textContent = marge.toFixed(1)+" %";
  } else {
    qs("#plateau-marge").textContent = "0 %";
  }
}

/* ---------------------------
   Sauvegarde Firestore
--------------------------- */
async function savePlateau(){
  setMsg("Enregistrement…");

  const plateauPlu = nz(qs("#plateau-plu").value);
  const plateauDes = nz(qs("#plateau-des").value);
  const plateauPv  = toNum(qs("#plateau-pv").value);

  if (!plateauPlu) return setMsg("PLU plateau manquant", "err");

  const rows = qsa("#plateau-compos tbody tr");

  const composants = rows.map(r => ({
    plu: nz(r.querySelector(".comp-plu").value),
    des: nz(r.querySelector(".comp-des").value),
    qty: toNum(r.querySelector(".comp-qty").value),
    pa:  toNum(r.querySelector(".comp-pa").value),
  })).filter(c => c.plu && c.qty > 0);

  if (!composants.length) return setMsg("Aucun composant valide", "err");

  // recalcul sécurité
  calcTotalPR();
  const prixRevient = toNum(qs("#plateau-pr").textContent);
  const marge = toNum(qs("#plateau-marge").textContent);

  try {
    if (!EDIT_ID) {
      // CREATE
      await addDoc(collection(db,"plateaux"),{
        userId: UID,
        plu: plateauPlu,
        designation: plateauDes,
        pv: plateauPv,
        prixRevient,
        marge,
        composants,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setMsg("✔️ Plateau créé", "ok");
    } else {
      // UPDATE
      await updateDoc(doc(db,"plateaux", EDIT_ID),{
        plu: plateauPlu,
        designation: plateauDes,
        pv: plateauPv,
        prixRevient,
        marge,
        composants,
        updatedAt: serverTimestamp(),
      });
      setMsg("✔️ Plateau modifié", "ok");
    }

    renderForm(null);
    await loadPlateaux();

  } catch(e){
    console.error(e);
    setMsg("Erreur : "+e.message, "err");
  }
}

/* ---------------------------
   Liste plateaux
--------------------------- */
async function loadPlateaux(){
  const qRef = query(
    collection(db,"plateaux"),
    where("userId","==",UID),
    orderBy("updatedAt","desc")
  );

  const snap = await getDocs(qRef);

  if (snap.empty) {
    el.list.innerHTML = `<div class="no-movements">Aucun plateau.</div>`;
    return;
  }

  let html = "";
  snap.forEach(d => {
    const p = d.data();
    const comps = (p.composants || [])
      .map(c => `${c.plu} (${c.qty})`)
      .join(", ");

    html += `
      <div class="trace-card" style="margin-bottom:10px;">
        <div class="trace-title">
          ${p.plu} — ${p.designation || ""} 
        </div>

        <div class="trace-meta">
          <strong>PV TTC :</strong> ${fmtMoney(p.pv)}<br>
          <strong>Prix de revient :</strong> ${fmtMoney(p.prixRevient)}<br>
          <strong>Marge :</strong> ${(p.marge || 0).toFixed(1)} %<br>
          <strong>Composants :</strong> ${comps}
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn btn-muted btn-edit" data-id="${d.id}">Modifier</button>
          <button class="btn btn-red btn-del" data-id="${d.id}">Supprimer</button>
        </div>
      </div>
    `;
  });

  el.list.innerHTML = html;

  qsa(".btn-edit").forEach(b => b.onclick = () => editPlateau(b.dataset.id));
  qsa(".btn-del").forEach(b => b.onclick = () => deletePlateau(b.dataset.id));
}

async function editPlateau(id){
  const ref = doc(db,"plateaux",id);
  const snap = await getDoc(ref);
  if(!snap.exists()) return;

  renderForm({ id, ...snap.data() });
  window.scrollTo({ top:0, behavior:"smooth" });
}

async function deletePlateau(id){
  if(!confirm("Supprimer ce plateau ?")) return;
  await deleteDoc(doc(db,"plateaux",id));
  await loadPlateaux();
}

/* ---------------------------
   Popup F9 (articles)
--------------------------- */
function bindPopup(){
  el.popupClose.onclick = closeF9;
  el.popupSearch.oninput = renderF9;
  el.popup.onclick = e => { if(e.target === el.popup) closeF9(); };
}

function openF9(mode){
  F9_MODE = mode;   // "plateau" ou rowId
  el.popupSearch.value = "";
  renderF9();
  el.popup.style.display = "flex";
}

function closeF9(){
  el.popup.style.display = "none";
  F9_MODE = null;
}

function renderF9(){
  const q = el.popupSearch.value.toLowerCase();

  const list = ARTICLES.filter(a =>
    String(a.PLU || "").toLowerCase().includes(q) ||
    String(a.Designation || "").toLowerCase().includes(q) ||
    String(a.NomLatin || "").toLowerCase().includes(q)
  );

  el.popupBody.innerHTML = list.map(a => `
    <tr class="pick" data-plu="${a.PLU}">
      <td>${a.PLU}</td>
      <td>${a.Designation || ""}</td>
      <td>${a.NomLatin || ""}</td>
    </tr>
  `).join("");

  qsa(".pick").forEach(tr=>{
    tr.onclick = ()=>{
      const plu = tr.dataset.plu;
      const art = ARTICLES.find(a => String(a.PLU) === String(plu));
      if(!art) return;

      applyArticle(F9_MODE, art);
      closeF9();
    };
  });
}

function applyArticle(mode, art){
  const plu = String(art.PLU || "");
  const des = String(art.Designation || "");

  // PLU plateau
  if(mode === "plateau"){
    qs("#plateau-plu").value = plu;
    qs("#plateau-des").value = des;
    qs("#plateau-pv").value =
      art.PVTTC_Choisi ?? art.PVTTC ?? art.PV_TTC ?? art.PV ?? "";
    calcTotalPR();
    return;
  }

  // ligne ingrédient
  if(mode && mode.startsWith("ing-")){
    const row = qs("#"+mode);
    if(!row) return;
    row.querySelector(".comp-plu").value = plu;
    row.querySelector(".comp-des").value = des;
    recalcRow(row);
  }
}
