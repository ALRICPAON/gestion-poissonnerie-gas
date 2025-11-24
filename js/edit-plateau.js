import { app, db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const nz = v => v == null ? "" : String(v).trim();
const toNum = v => {
  const x = parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};

const el = {
  nom: qs("#model-nom"),
  prix: qs("#model-prix"),
  tbody: qs("#compo-table tbody"),
  btnAdd: qs("#btn-add"),
  btnSave: qs("#btn-save"),
  msg: qs("#msg"),

  popup: qs("#popup-f9"),
  popupBody: qs("#popup-f9 tbody"),
  popupSearch: qs("#f9-search"),
  popupClose: qs("#f9-close"),
};

let UID = null;
let ARTICLES = [];
let F9_ROW = null;
let MODEL_ID = new URLSearchParams(location.search).get("id") || null;

const auth = getAuth(app);
onAuthStateChanged(auth, async user => {
  if (!user) return;
  UID = user.uid;

  await loadArticles();
  bindPopup();

  el.btnAdd.onclick = addRow;
  el.btnSave.onclick = saveModel;

  if (MODEL_ID) await loadModel(MODEL_ID);
  else addRow(); // 1 ligne par défaut
});

async function loadArticles() {
  const snap = await getDocs(collection(db, "articles"));
  ARTICLES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  ARTICLES.sort((a,b)=> nz(a.Designation).localeCompare(nz(b.Designation)));
}

/* ---------- F9 ---------- */
function bindPopup() {
  el.popupClose.onclick = closeF9;
  el.popupSearch.oninput = renderF9;
  el.popup.onclick = e => { if (e.target === el.popup) closeF9(); };
}
function openF9(rowId) {
  F9_ROW = rowId;
  el.popupSearch.value = "";
  renderF9();
  el.popup.style.display = "flex";
}
function closeF9() {
  el.popup.style.display = "none";
  F9_ROW = null;
}
function renderF9() {
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

  qsa(".pick").forEach(tr => {
    tr.onclick = () => {
      const plu = tr.dataset.plu;
      const art = ARTICLES.find(a => String(a.PLU) === String(plu));
      if (!art || !F9_ROW) return;

      const row = qs("#"+F9_ROW);
      row.querySelector(".c-plu").value = plu;
      row.querySelector(".c-des").value = art.Designation || "";
      closeF9();
    };
  });
}

/* ---------- Rows ---------- */
function addRow(data=null) {
  const rowId = "c-" + Math.random().toString(36).slice(2,8);

  el.tbody.insertAdjacentHTML("beforeend", `
    <tr id="${rowId}">
      <td><input class="input c-plu" placeholder="PLU" value="${data?.plu||""}"></td>
      <td>
        <input class="input c-des" placeholder="Désignation" disabled value="${data?.designation||""}">
      </td>
      <td><input class="input c-kg" placeholder="0.250" value="${data?.kg ?? ""}"></td>
      <td>
        <select class="input c-mode">
          <option value="per_plateau" ${data?.mode==="per_plateau"?"selected":""}>/ plateau</option>
          <option value="per_person" ${data?.mode==="per_person"?"selected":""}>/ personne</option>
        </select>
      </td>
      <td style="display:flex; gap:.25rem;">
        <button class="btn btn-muted c-f9">F9</button>
        <button class="btn btn-red c-del">X</button>
      </td>
    </tr>
  `);

  const row = qs("#"+rowId);

  row.querySelector(".c-f9").onclick = () => openF9(rowId);
  row.querySelector(".c-del").onclick = () => row.remove();

  row.querySelector(".c-plu").onchange = () => {
    const plu = nz(row.querySelector(".c-plu").value);
    const art = ARTICLES.find(a => String(a.PLU) === String(plu));
    if (art) row.querySelector(".c-des").value = art.Designation || "";
  };
}

/* ---------- Load existing model ---------- */
async function loadModel(id) {
  const snap = await getDoc(doc(db,"plateaux_models",id));
  if (!snap.exists()) return;

  const m = snap.data();
  if (m.userId !== UID) return;

  el.nom.value = m.nom || "";
  el.prix.value = m.prixVente ?? "";

  el.tbody.innerHTML = "";
  (m.composition||[]).forEach(c => addRow(c));
}

/* ---------- Save ---------- */
async function saveModel() {
  el.msg.textContent = "Enregistrement…";

  const nom = nz(el.nom.value);
  if (!nom) return showMsg("Nom obligatoire", "err");

  const prixVente = toNum(el.prix.value) || null;

  const composition = qsa("#compo-table tbody tr")
    .map(tr => ({
      plu: nz(tr.querySelector(".c-plu").value),
      designation: nz(tr.querySelector(".c-des").value),
      kg: toNum(tr.querySelector(".c-kg").value),
      mode: tr.querySelector(".c-mode").value
    }))
    .filter(c => c.plu && c.kg > 0);

  if (!composition.length) return showMsg("Composition vide", "err");

  const payload = {
    nom,
    prixVente,
    composition,
    userId: UID,
    updatedAt: serverTimestamp()
  };

  if (MODEL_ID) {
    await setDoc(doc(db,"plateaux_models",MODEL_ID), payload, { merge:true });
  } else {
    const ref = doc(collection(db,"plateaux_models"));
    MODEL_ID = ref.id;
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
  }

  showMsg("✅ Modèle enregistré", "ok");
  setTimeout(()=> window.location.href="plateaux.html", 400);
}

function showMsg(t, type="info") {
  const c = { info:"#ccc", ok:"#52e16b", err:"#ff6868"}[type]||"#ccc";
  el.msg.innerHTML = `<span style="color:${c}">${t}</span>`;
}
