import { app, db } from "../js/firebase-init.js";
import {
  doc, getDoc, updateDoc, setDoc, collection, addDoc,
  getDocs, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const storage = getStorage(app);

// ---------- Utils ----------
const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const nz  = (v) => (v == null ? "" : String(v).trim());
const toNum = (v) => {
  const x = parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};
const fmtMoney = (n) => Number(n||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
const fmtISO   = (d) => (d?.toISOString?.() ?? new Date().toISOString()).slice(0,10);
const getParam = (k) => new URLSearchParams(location.search).get(k);

// Lot id: horodaté + index
function makeLotId(baseTs, idx){
  const d = baseTs ? new Date(baseTs) : new Date();
  const pad = (n,l=2)=>String(n).padStart(l,"0");
  const id = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(idx)}`;
  return id;
}

// ---------- State ----------
const achatId = getParam("id");
const achatRef = doc(db, "achats", achatId);
const linesCol = collection(achatRef, "lignes");

let currentAchat = null;
let lines = [];      
let focusedLineId = null;
let focusedColIdx = 0;
let articlesCache = [];

// ===================================================
// LOAD
// ===================================================
async function loadAchat(){
  const snap = await getDoc(achatRef);
  if (!snap.exists()){
    alert("Achat introuvable.");
    return;
  }
  currentAchat = snap.data();

  qs("#achat-date").value       = currentAchat.date?.toDate ? fmtISO(currentAchat.date.toDate()) : fmtISO(new Date());
  qs("#achat-fourn-code").value = nz(currentAchat.fournisseurCode);
  qs("#achat-fourn-nom").value  = nz(currentAchat.fournisseurNom);
  qs("#achat-fourn-desig").value= nz(currentAchat.designationFournisseur);
  qs("#achat-type").value       = currentAchat.type   || "commande";
  qs("#achat-statut").value     = currentAchat.statut || "new";
  qs("#achat-total-ht").value   = fmtMoney(currentAchat.montantHT||0);
  qs("#achat-total-ttc").value  = fmtMoney(currentAchat.montantTTC||0);

  const snapLines = await getDocs(query(linesCol, orderBy("createdAt","asc")));
  lines = [];
  snapLines.forEach(d => lines.push({ id: d.id, ...d.data() }));
  renderLines();
  recomputeTotals();
}

// ===================================================
// RENDER
// ===================================================
function renderLines(){
  const tbody = qs("#achat-lines");
  if (!tbody) return;

  tbody.innerHTML = lines.map((r, idx) => {
    const lot = nz(r.lot);
    const ok  = r.received ? "✅" : "";

    return `
      <tr data-id="${r.id}">
        <td><input class="inp plu" value="${nz(r.plu)}" placeholder="PLU" /></td>

        <td>
          <input class="inp designation" value="${nz(r.designation)}" placeholder="Désignation" />

          <div class="subline">
            <span class="pill" data-edit="nomLatin">${nz(r.nomLatin) || "—"}</span>
            <span class="pill" data-edit="zone">${nz(r.zone) || "—"}</span>
            <span class="pill" data-edit="sousZone">${nz(r.sousZone) || "—"}</span>
            <span class="pill" data-edit="engin">${nz(r.engin) || "—"}</span>
            <span class="pill" data-edit="allergenes">${nz(r.allergenes) || "—"}</span>
          </div>
        </td>

        <td><input class="inp colis"  type="number" step="1"     min="0" value="${nz(r.colis)}" /></td>
        <td><input class="inp pcolis" type="number" step="0.001" min="0" value="${nz(r.poidsColisKg)}" /></td>
        <td><input class="inp ptotal" type="number" step="0.001" min="0" value="${nz(r.poidsTotalKg)}" /></td>
        <td><input class="inp prixkg" type="number" step="0.01"  min="0" value="${nz(r.prixKg)}" /></td>
        <td><input class="inp mht"    type="number" step="0.01"  min="0" value="${nz(r.montantHT)}" /></td>

        <td><input class="inp lot" value="${lot}" readonly /></td>
        <td><button class="btn btn-small btn-qr">◼︎</button></td>
        <td class="txt-center">${ok}</td>

        <td>
          <button class="btn btn-small btn-article">F9</button>
          <button class="btn btn-small btn-afmap">AF</button>
          <button class="btn btn-small btn-photo">📷</button>
          <button class="btn btn-small btn-del">🗑️</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="12">Aucune ligne.</td></tr>`;

  bindRowEvents();
  restoreFocus();
}

// ===================================================
// BIND
// ===================================================
function bindRowEvents(){
  qsa("#achat-lines tr").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const get = (sel)=> tr.querySelector(sel);

    tr.addEventListener("focusin", () => { focusedLineId = id });

    tr.querySelectorAll("input.inp").forEach((inp, colIdx) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        focusedColIdx = colIdx;

        saveLine(id).then(async () => {
          const trs = qsa("#achat-lines tr");
          const rowIdx = trs.findIndex(x => x.getAttribute("data-id") === id);
          let nextTr = trs[rowIdx+1];

          if (!nextTr){
            await addLine();
            const trs2 = qsa("#achat-lines tr");
            nextTr = trs2[trs2.length-1];
          }

          const inputs = nextTr.querySelectorAll("input.inp");
          const sameCol = inputs[colIdx] || inputs[0];
          sameCol?.focus();
          sameCol?.select?.();
        });
      });
    });

    // Auto calc
    const onCalc = async () => {
      const colis  = toNum(get(".colis")?.value);
      const pcolis = toNum(get(".pcolis")?.value);
      let ptotal   = toNum(get(".ptotal")?.value);

      if (colis && pcolis)
        ptotal = +(colis * pcolis).toFixed(3);

      const prixkg = toNum(get(".prixkg")?.value);
      const mht    = +(ptotal * prixkg).toFixed(2);

      get(".ptotal").value = isNaN(ptotal)? "" : String(ptotal);
      get(".mht").value    = isNaN(mht)?    "" : String(mht);

      await saveLine(id);
      recomputeTotals();
    };

    ["change","blur"].forEach(ev => {
      get(".colis")?.addEventListener(ev, onCalc);
      get(".pcolis")?.addEventListener(ev, onCalc);
      get(".ptotal")?.addEventListener(ev, onCalc);
      get(".prixkg")?.addEventListener(ev, onCalc);
      get(".mht")?.addEventListener(ev, async () => { await saveLine(id); recomputeTotals(); });

      get(".designation")?.addEventListener(ev, () => saveLine(id));
      get(".plu")?.addEventListener(ev, async () => {
        await saveLine(id);
        await autofillTraceFromPLU(id);
        renderLines();
      });
    });

    tr.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => startInlineEditPill(id, p));
    });

    get(".btn-article")?.addEventListener("click", () => openPopupArticles(id));
    tr.addEventListener("keydown", (e) => { if (e.key === "F9"){ e.preventDefault(); openPopupArticles(id); } });

    get(".btn-afmap")?.addEventListener("click", () => applyAFMapForLine(id));
    get(".btn-qr")?.addEventListener("click", () => openQRForLine(id));
    get(".btn-photo")?.addEventListener("click", () => uploadPhotoForLine(id));
    get(".btn-del")?.addEventListener("click", async () => {
      if (!confirm("Supprimer cette ligne ?")) return;
      await deleteLine(id);
    });
  });
}

// ===================================================
// FOCUS RESTORE
// ===================================================
function restoreFocus(){
  if (!focusedLineId) return;

  const tr = document.querySelector(`tr[data-id="${focusedLineId}"]`);
  if (!tr) return;

  const inputs = tr.querySelectorAll("input.inp");
  const target = inputs[focusedColIdx] || inputs[0];

  target?.focus();
  target?.select?.();
}

// ===================================================
// INLINE EDIT PILLS
// ===================================================
async function startInlineEditPill(lineId, pillEl){
  if (pillEl.classList.contains("editing")) return;
  pillEl.classList.add("editing");

  const field = pillEl.getAttribute("data-edit");
  const oldVal = pillEl.textContent === "—" ? "" : pillEl.textContent;

  pillEl.innerHTML = `<input value="${oldVal}">`;
  const input = pillEl.querySelector("input");
  input.focus(); input.select();

  const commit = async (save) =>{
    const newVal = save ? nz(input.value) : oldVal;
    pillEl.classList.remove("editing");
    pillEl.innerHTML = newVal || "—";

    if (save && newVal !== oldVal){
      await setDoc(doc(linesCol, lineId), { [field]: newVal, updatedAt:Timestamp.fromDate(new Date()) }, { merge:true });
      const idx = lines.findIndex(x=>x.id===lineId);
      if (idx>=0) lines[idx][field] = newVal;
    }
  };

  input.addEventListener("keydown", (e)=>{
    if(e.key==="Enter") commit(true);
    if(e.key==="Escape")commit(false);
  });
  input.addEventListener("blur", ()=>commit(true));
}

// ===================================================
// SAVE LINE
// ===================================================
async function saveLine(lineId){
  const tr = qs(`tr[data-id="${lineId}"]`);
  if (!tr) return;

  const idx = lines.findIndex(x=>x.id===lineId);
  if (idx<0) return;

  const plu  = nz(tr.querySelector(".plu")?.value);
  const des  = nz(tr.querySelector(".designation")?.value);
  const colis= toNum(tr.querySelector(".colis")?.value);
  const pcolis=toNum(tr.querySelector(".pcolis")?.value);
  const ptotal=toNum(tr.querySelector(".ptotal")?.value);
  const prixkg=toNum(tr.querySelector(".prixkg")?.value);
  const mht   =toNum(tr.querySelector(".mht")?.value);

  const baseTs = currentAchat?.date?.toDate?.() ?? new Date();
  if (!lines[idx].lot){
    const lot = makeLotId(baseTs, idx+1);
    lines[idx].lot = lot;
    tr.querySelector(".lot").value = lot;
  }
  if (!lines[idx].qr_url){
    lines[idx].qr_url = await ensureQRForLine(lines[idx].lot);
  }

  await setDoc(
    doc(linesCol, lineId),
    {
      plu, designation:des,
      colis, poidsColisKg:pcolis,
      poidsTotalKg:ptotal,
      prixKg:prixkg,
      montantHT:mht,
      lot:lines[idx].lot,
      qr_url:lines[idx].qr_url || "",
      updatedAt:Timestamp.fromDate(new Date())
    },
    { merge:true }
  );

  lines[idx] = {
    ...lines[idx],
    plu, designation:des,
    colis, poidsColisKg:pcolis,
    poidsTotalKg:ptotal,
    prixKg:prixkg,
    montantHT:mht
  };
}

// ===================================================
// DELETE LINE
// ===================================================
async function deleteLine(lineId){
  await setDoc(doc(linesCol, lineId), { __deleted:true }, { merge:true });
  lines = lines.filter(x => x.id !== lineId);
  renderLines();
  recomputeTotals();
}

// ===================================================
// ADD LINE
// ===================================================
async function addLine(){
  const baseTs = currentAchat?.date?.toDate?.() ?? new Date();
  const idx = lines.length + 1;
  const lot = makeLotId(baseTs, idx);
  const qr_url = await ensureQRForLine(lot);

  const ref = await addDoc(linesCol, {
    plu:"", designation:"",
    colis:0, poidsColisKg:0, poidsTotalKg:0,
    prixKg:0, montantHT:0, montantTTC:0,
    fournisseurRef:"", aliasFournisseur:"",
    nomLatin:"", zone:"", sousZone:"", engin:"", allergenes:"",
    lot, qr_url, photo_url:"",
    qr_scanned:false, qr_scan_date:null,
    received: currentAchat.type === "BL" ? true : false,
    createdAt:Timestamp.fromDate(new Date()),
    updatedAt:Timestamp.fromDate(new Date())
  });

  lines.push({ id:ref.id, plu:"", designation:"", lot, qr_url, received:false });
  renderLines();

  const lastTr = qsa("#achat-lines tr").pop();
  lastTr?.querySelector(".plu")?.focus();
}

// ===================================================
// TOTALS
// ===================================================
async function recomputeTotals(){
  const totalHT = lines.reduce((s,x)=> s + Number(x.montantHT||0), 0);
  const totalTTC = totalHT;

  qs("#achat-total-ht").value  = fmtMoney(totalHT);
  qs("#achat-total-ttc").value = fmtMoney(totalTTC);

  await updateDoc(achatRef, {
    montantHT:totalHT,
    montantTTC:totalTTC,
    updatedAt:Timestamp.fromDate(new Date())
  });
}

// ===================================================
// HEADER SAVE
// ===================================================
async function saveHeader(){
  const dateISO = qs("#achat-date").value || fmtISO(new Date());
  const type    = qs("#achat-type").value;
  const statut  = qs("#achat-statut").value;

  await updateDoc(achatRef, {
    date:Timestamp.fromDate(new Date(dateISO + "T12:00:00")),
    fournisseurCode: nz(qs("#achat-fourn-code").value),
    fournisseurNom:  nz(qs("#achat-fourn-nom").value),
    designationFournisseur: nz(qs("#achat-fourn-desig").value),
    type, statut,
    updatedAt:Timestamp.fromDate(new Date())
  });

  currentAchat.type   = type;
  currentAchat.statut = statut;
  alert("✅ En-tête enregistré.");
}

// ===================================================
// CONVERT → BL  (RESTE IDENTIQUE)
// ===================================================
async function convertToBL(){
  if (!confirm("Convertir cette commande en BL ?")) return;

  await updateDoc(achatRef, { type:"BL", statut:"received", updatedAt:Timestamp.fromDate(new Date()) });
  currentAchat.type = "BL";
  currentAchat.statut="received";

  const stockCol = collection(db,"stock_movements");
  const now = Timestamp.fromDate(new Date());

  for (let i=0;i<lines.length;i++){
    const L = lines[i];
    const refLine = doc(linesCol, L.id);

    if (!L.lot)
      L.lot = makeLotId(currentAchat?.date?.toDate?.(), i+1);
    if (!L.qr_url)
      L.qr_url = await ensureQRForLine(L.lot);

    await setDoc(refLine,
      {
        lot:L.lot,
        qr_url:L.qr_url,
        received:true,
        qr_scanned:L.qr_scanned||false,
        updatedAt:now
      },
      { merge:true }
    );

    await addDoc(stockCol,{
      date:now, type:"in",
      achatId, ligneId:L.id,
      plu:L.plu || "", lot:L.lot,
      poidsKg:Number(L.poidsTotalKg||0),
      prixKg:Number(L.prixKg||0),
      montantHT:Number(L.montantHT||0)
    });

    lines[i]={ ...L, received:true };
  }

  renderLines();
  alert("✅ Commande convertie → BL + stock OK");
}

// ===================================================
// QR
// ===================================================
async function ensureQRForLine(lot){
  const url = `${location.origin}/pages/lot.html?id=${encodeURIComponent(lot)}`;
  const tmp = document.createElement("div");

  // @ts-ignore
  const qr = new QRCode(tmp,{ text:url, width:128, height:128 });
  await new Promise(res=>setTimeout(res,20));

  const canvas=tmp.querySelector("canvas");
  const dataUrl = canvas ? canvas.toDataURL("image/png"):"";
  return dataUrl;
}

function openQRForLine(lineId){
  const L = lines.find(x=>x.id===lineId);
  if (!L?.qr_url){ alert("QR non généré"); return; }

  const w = window.open("");
  w.document.write(`<img src="${L.qr_url}" style="max-width:100%;">`);
}

// ===================================================
// PHOTO
// ===================================================
async function uploadPhotoForLine(lineId){
  const input=document.createElement("input");
  input.type="file"; input.accept="image/*";

  input.onchange = async () => {
    const file=input.files?.[0];
    if(!file) return;

    const path=`achats/${achatId}/lignes/${lineId}/sanitaire-${Date.now()}.jpg`;
    const sref= storageRef(storage,path);

    await uploadBytes(sref,file);
    const url= await getDownloadURL(sref);

    await setDoc(doc(linesCol,lineId),
      { photo_url:url, updatedAt:Timestamp.fromDate(new Date()) },
      { merge:true }
    );

    const idx = lines.findIndex(x=>x.id===lineId);
    if (idx>=0) lines[idx].photo_url=url;

    alert("✅ Photo sanitaire attachée");
  };

  input.click();
}

// ===================================================
// Auto Traça via PLU
// ===================================================
async function autofillTraceFromPLU(lineId){
  const idx = lines.findIndex(x=>x.id===lineId);
  if (idx<0) return;

  const L = lines[idx];
  const plu=nz(L.plu);
  if(!plu) return;

  const artSnap= await getDoc(doc(db,"articles",plu));
  if(!artSnap.exists()) return;
  const A = artSnap.data();

  const patch={
    nomLatin: A.NomLatin || A.nomLatin || L.nomLatin || "",
    zone:     A.Zone     || A.zone     || L.zone     || "",
    sousZone: A.SousZone || A.sousZone || L.sousZone || "",
    engin:    A.Engin    || A.engin    || L.engin    || "",
    allergenes:A.Allergenes||A.allergenes||L.allergenes||"",
    designation: L.designation || A.Designation || A.designation || ""
  };

  await setDoc(
    doc(linesCol,lineId),
    { ...patch, updatedAt:Timestamp.fromDate(new Date()) },
    { merge:true }
  );

  lines[idx]={ ...lines[idx], ...patch };
}

// ===================================================
// AF_MAP
// ===================================================
async function applyAFMapForLine(lineId){
  const idx = lines.findIndex(x=>x.id===lineId);
  if (idx<0) return;

  const fourn = nz(qs("#achat-fourn-code").value);
  if (!fourn){ alert("Code fournisseur manquant"); return; }

  const refF = prompt("Référence fournisseur ?");
  if (!refF) return;

  const id = `${fourn}__${refF}`.toUpperCase();
  const snap = await getDoc(doc(db,"af_map",id));
  if (!snap.exists()){
    alert("Aucune correspondance AF_MAP");
    return;
  }

  const M = snap.data();
  const patch = {
    aliasFournisseur: M.aliasFournisseur || "",
    fournisseurRef:  M.refFournisseur   || refF,
    nomLatin: M.nomLatin || lines[idx].nomLatin || "",
    zone:     M.zone     || lines[idx].zone     || "",
    sousZone: M.sousZone || lines[idx].sousZone || "",
    engin:    M.engin    || lines[idx].engin    || "",
    allergenes:M.allergenes||lines[idx].allergenes||"",
    designation: lines[idx].designation || M.designationInterne || ""
  };

  await setDoc(doc(linesCol,lineId), { ...patch, updatedAt:Timestamp.fromDate(new Date()) }, { merge:true });
  lines[idx] = { ...lines[idx], ...patch };
  renderLines();
}

// ===================================================
// Popup Articles
// ===================================================
async function openPopupArticles(lineId){
  focusedLineId = lineId;

  const modal   = qs("#popup-articles");
  const tbody   = qs("#articles-list");
  const search  = qs("#search-articles");

  modal.style.display = "block";

  if (articlesCache.length === 0){
    const snap = await getDocs(collection(db,"articles"));
    snap.forEach(d =>{
      const a = d.data();
      articlesCache.push({
        id: d.id,
        plu: a.PLU||a.plu||d.id,
        designation: a.Designation||a.designation||"",
        nomLatin: a.NomLatin||a.nomLatin||"",
        categorie: a.Categorie||a.categorie||""
      });
    });
  }

  function render(filter=""){
    const q = filter.toLowerCase();

    const rows = articlesCache.filter(a =>
      (`${a.plu} ${a.designation} ${a.nomLatin}`.toLowerCase()).includes(q)
    );

    tbody.innerHTML = rows.map(a => `
      <tr data-plu="${a.plu}" data-des="${a.designation}" data-nl="${a.nomLatin}">
        <td>${a.plu}</td>
        <td>${a.designation}</td>
        <td>${a.nomLatin}</td>
        <td>${a.categorie}</td>
      </tr>
    `).join("") || `<tr><td colspan="4">Aucun article</td></tr>`;

    tbody.querySelectorAll("tr[data-plu]").forEach(tr => {
      tr.addEventListener("dblclick", () => applySelectedArticle(tr));
    });
  }

  async function applySelectedArticle(tr){
    const plu   = tr.getAttribute("data-plu");
    const des   = tr.getAttribute("data-des");

    const row = qs(`tr[data-id="${focusedLineId}"]`);
    if (!row) return;

    const inpPLU = row.querySelector(".plu");
    const inpDES = row.querySelector(".designation");

    if (inpPLU) inpPLU.value = plu;
    if (inpDES) inpDES.value = des;

    await saveLine(focusedLineId);
    await autofillTraceFromPLU(focusedLineId);

    const idx = lines.findIndex(x=>x.id===focusedLineId);
    if (idx >= 0){
      const L = lines[idx];
      const pills = row.querySelectorAll(".pill");
      pills.forEach(p =>{
        const f = p.getAttribute("data-edit");
        p.textContent = L[f] || "—";
      });
    }

    restoreFocus();
    closePopup();
  }

  render();
  search.oninput = () => render(search.value);

  // ✅ bouton X
  qs("#btnClosePopup")?.onclick = closePopup;
}



// ===================================================
// CLOSE POPUP
// ===================================================
function closePopup(){
  const modal = qs("#popup-articles");
  if (modal) modal.style.display = "none";
}

// ===================================================
// Bind Header
// ===================================================
function bindHeader(){
  qs("#btnSaveHeader")?.addEventListener("click", saveHeader);
  qs("#btnAddLine")?.addEventListener("click", addLine);
  qs("#btnConvertBL")?.addEventListener("click", convertToBL);
}

// ===================================================
// Init
// ===================================================
window.addEventListener("DOMContentLoaded", async () => {
  bindHeader();
  await loadAchat();
});
