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
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const nz = (v) => (v == null ? "" : String(v).trim());
const toNum = (v) => {
  const x = parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};
const fmtMoney = (n) => Number(n||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
const fmtISO = (d) => (d?.toISOString?.() ?? new Date().toISOString()).slice(0,10);
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
let lines = [];      // { id, ...data }
let focusedLineId = null; // pour renvoyer PLU depuis popup

// ---------- Load achat + lines ----------
async function loadAchat(){
  const snap = await getDoc(achatRef);
  if (!snap.exists()){
    alert("Achat introuvable.");
    return;
  }
  currentAchat = snap.data();

  // Header -> UI
  qs("#achat-date").value = currentAchat.date?.toDate ? fmtISO(currentAchat.date.toDate()) : fmtISO(new Date());
  qs("#achat-fourn-code").value = nz(currentAchat.fournisseurCode);
  qs("#achat-fourn-nom").value  = nz(currentAchat.fournisseurNom);
  qs("#achat-fourn-desig").value = nz(currentAchat.designationFournisseur);
  qs("#achat-type").value = currentAchat.type || "commande";
  qs("#achat-statut").value = currentAchat.statut || "new";
  qs("#achat-total-ht").value = fmtMoney(currentAchat.montantHT||0);
  qs("#achat-total-ttc").value = fmtMoney(currentAchat.montantTTC||0);

  // lignes
  const snapLines = await getDocs(query(linesCol, orderBy("createdAt","asc")));
  lines = [];
  snapLines.forEach(d => lines.push({ id: d.id, ...d.data() }));
  renderLines();
  recomputeTotals(); // rafraîchit totaux
}

// ---------- Render lines ----------
function renderLines(){
  const tbody = qs("#achat-lines");
  if (!tbody) return;

  tbody.innerHTML = lines.map((r, idx) => {
    const lot = nz(r.lot);
    const ok = r.received ? "✅" : "";
    const qricon = `<span class="badge ${r.qr_url?'badge-blue':'badge-muted'}" title="QR">${r.qr_url?'QR':''}</span>`;
    return `
      <tr data-id="${r.id}">
        <td><input class="inp plu" value="${nz(r.plu)}" placeholder="PLU" /></td>
        <td>
          <input class="inp designation" value="${nz(r.designation)}" placeholder="Désignation" />
          <div class="sub muted">${nz(r.nomLatin)} ${nz(r.zone)} ${nz(r.sousZone)} ${nz(r.engin)}</div>
        </td>
        <td><input class="inp colis" type="number" step="1" min="0" value="${nz(r.colis)}" /></td>
        <td><input class="inp pcolis" type="number" step="0.001" min="0" value="${nz(r.poidsColisKg)}" /></td>
        <td><input class="inp ptotal" type="number" step="0.001" min="0" value="${nz(r.poidsTotalKg)}" /></td>
        <td><input class="inp prixkg" type="number" step="0.01" min="0" value="${nz(r.prixKg)}" /></td>
        <td><input class="inp mht" type="number" step="0.01" min="0" value="${nz(r.montantHT)}" /></td>
        <td><input class="inp lot" value="${lot}" readonly /></td>
        <td>
          <button class="btn btn-small btn-qr" title="Voir QR">◼︎</button>
        </td>
        <td class="txt-center">${ok}</td>
        <td>
          <button class="btn btn-small btn-article">F9</button>
          <button class="btn btn-small btn-photo">📷</button>
          <button class="btn btn-small btn-del">🗑️</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="11">Aucune ligne.</td></tr>`;

  // bind interactions
  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const get = (sel) => tr.querySelector(sel);

    // Focused line tracker (for popup)
    tr.addEventListener("focusin", () => { focusedLineId = id; });

    // Auto-calc poids total / montant
    const onCalc = async () => {
      const colis = toNum(get(".colis")?.value);
      const pcolis = toNum(get(".pcolis")?.value);
      let ptotal = toNum(get(".ptotal")?.value);
      if (colis && pcolis) ptotal = +(colis * pcolis).toFixed(3);
      const prixkg = toNum(get(".prixkg")?.value);
      const mht = +(ptotal * prixkg).toFixed(2);

      get(".ptotal").value = isNaN(ptotal)? "": String(ptotal);
      get(".mht").value    = isNaN(mht)? "": String(mht);

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
      get(".plu")?.addEventListener(ev, () => saveLine(id));
    });

    // Popup Articles (F9)
    get(".btn-article")?.addEventListener("click", () => openPopupArticles(id));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "F9") { e.preventDefault(); openPopupArticles(id); }
    });

    // QR
    get(".btn-qr")?.addEventListener("click", () => openQRForLine(id));

    // Photo sanitaire
    get(".btn-photo")?.addEventListener("click", () => uploadPhotoForLine(id));

    // Delete
    get(".btn-del")?.addEventListener("click", async () => {
      if (!confirm("Supprimer cette ligne ?")) return;
      await deleteLine(id);
    });
  });
}

// ---------- Save/Delete line ----------
async function saveLine(lineId){
  const tr = qs(`tr[data-id="${lineId}"]`);
  if (!tr) return;

  const plu = nz(tr.querySelector(".plu")?.value);
  const designation = nz(tr.querySelector(".designation")?.value);
  const colis = toNum(tr.querySelector(".colis")?.value);
  const pcolis= toNum(tr.querySelector(".pcolis")?.value);
  const ptotal= toNum(tr.querySelector(".ptotal")?.value);
  const prixkg= toNum(tr.querySelector(".prixkg")?.value);
  const mht  = toNum(tr.querySelector(".mht")?.value);

  // lot & qr garantis dès COMMANDE
  let idx = lines.findIndex(x=>x.id===lineId);
  const baseTs = currentAchat?.date?.toDate?.() ?? new Date();
  if (!lines[idx].lot) {
    const lot = makeLotId(baseTs, idx+1);
    lines[idx].lot = lot;
    tr.querySelector(".lot").value = lot;
  }
  if (!lines[idx].qr_url) {
    lines[idx].qr_url = await ensureQRForLine(lines[idx].lot);
  }

  const ref = doc(linesCol, lineId);
  await setDoc(ref, {
    plu, designation, colis, poidsColisKg: pcolis, poidsTotalKg: ptotal,
    prixKg: prixkg, montantHT: mht,
    lot: lines[idx].lot,
    qr_url: lines[idx].qr_url || "",
    updatedAt: Timestamp.fromDate(new Date())
  }, { merge:true });

  // maj cache
  lines[idx] = { ...lines[idx],
    plu, designation, colis, poidsColisKg:pcolis, poidsTotalKg:ptotal, prixKg:prixkg, montantHT:mht
  };
}

async function deleteLine(lineId){
  await setDoc(doc(linesCol, lineId), { __deleted:true }, { merge:true }); // soft delete (simple)
  lines = lines.filter(x => x.id !== lineId);
  renderLines();
  recomputeTotals();
}

// ---------- Add line ----------
async function addLine(){
  const baseTs = currentAchat?.date?.toDate?.() ?? new Date();
  const idx = lines.length + 1;
  const lot = makeLotId(baseTs, idx);
  const qr_url = await ensureQRForLine(lot);

  const ref = await addDoc(linesCol, {
    plu: "", designation: "",
    colis: 0, poidsColisKg: 0, poidsTotalKg: 0,
    prixKg: 0, montantHT: 0, montantTTC: 0,
    fournisseurRef:"", aliasFournisseur:"",
    nomLatin:"", zone:"", sousZone:"", engin:"", allergenes:"",
    lot, qr_url, photo_url:"",
    qr_scanned:false, qr_scan_date:null,
    received: currentAchat.type === "BL" ? true : false,
    createdAt: Timestamp.fromDate(new Date()),
    updatedAt: Timestamp.fromDate(new Date())
  });

  lines.push({ id: ref.id, plu:"", designation:"", lot, qr_url, received:false });
  renderLines();
}

// ---------- Totals ----------
async function recomputeTotals(){
  const totalHT = lines.reduce((s,x)=> s + Number(x.montantHT||0), 0);
  const totalTTC = totalHT; // ⚠️ TVA: à affiner si besoin
  qs("#achat-total-ht").value = fmtMoney(totalHT);
  qs("#achat-total-ttc").value = fmtMoney(totalTTC);
  await updateDoc(achatRef, {
    montantHT: totalHT, montantTTC: totalTTC,
    updatedAt: Timestamp.fromDate(new Date())
  });
}

// ---------- Header save ----------
async function saveHeader(){
  const dateISO = qs("#achat-date").value || fmtISO(new Date());
  const type = qs("#achat-type").value;
  const statut = qs("#achat-statut").value;

  await updateDoc(achatRef, {
    date: Timestamp.fromDate(new Date(dateISO + "T12:00:00")),
    fournisseurCode: nz(qs("#achat-fourn-code").value),
    fournisseurNom: nz(qs("#achat-fourn-nom").value),
    designationFournisseur: nz(qs("#achat-fourn-desig").value),
    type, statut,
    updatedAt: Timestamp.fromDate(new Date())
  });

  currentAchat.type = type;
  currentAchat.statut = statut;
  alert("✅ En-tête enregistré.");
}

// ---------- Convert Commande -> BL ----------
async function convertToBL(){
  if (!confirm("Convertir cette commande en BL ?")) return;

  // 1) marquer l'achat
  await updateDoc(achatRef, { type:"BL", statut:"received", updatedAt: Timestamp.fromDate(new Date()) });
  currentAchat.type = "BL";
  currentAchat.statut = "received";

  // 2) pour chaque ligne: garantir lot + qr + received + stock IN
  const stockCol = collection(db, "stock_movements");
  const now = Timestamp.fromDate(new Date());

  for (let i=0;i<lines.length;i++){
    const L = lines[i];
    const refLine = doc(linesCol, L.id);

    // garantir lot/qr
    if (!L.lot) { L.lot = makeLotId(currentAchat?.date?.toDate?.(), i+1); }
    if (!L.qr_url) { L.qr_url = await ensureQRForLine(L.lot); }

    const received = true;
    await setDoc(refLine, {
      lot: L.lot, qr_url: L.qr_url, received, qr_scanned: L.qr_scanned||false,
      updatedAt: now
    }, { merge:true });

    // Stock IN
    await addDoc(stockCol, {
      date: now,
      type: "in",
      achatId, ligneId: L.id,
      plu: L.plu || "",
      lot: L.lot,
      poidsKg: Number(L.poidsTotalKg||0),
      prixKg: Number(L.prixKg||0),
      montantHT: Number(L.montantHT||0)
    });

    // maj cache
    lines[i] = { ...L, received:true };
  }

  renderLines();
  alert("✅ Commande convertie en BL, entrées stock générées.");
}

// ---------- QR helpers ----------
async function ensureQRForLine(lot){
  // Génère un dataURL de QR rapidement (client-side) pointant vers une page lot
  const url = `${location.origin}/pages/lot.html?id=${encodeURIComponent(lot)}`;
  // fabrique un canvas temporaire
  const tmp = document.createElement("div");
  // @ts-ignore global QRCode
  const qr = new QRCode(tmp, { text: url, width: 128, height: 128 });
  // attendre que le canvas apparaisse
  await new Promise(res => setTimeout(res, 20));
  const canvas = tmp.querySelector("canvas");
  const dataUrl = canvas ? canvas.toDataURL("image/png") : "";
  return dataUrl; // on stocke directement un dataURL (simple). Alternative: stocker l'URL 'url'
}

function openQRForLine(lineId){
  const L = lines.find(x=>x.id===lineId);
  if (!L?.qr_url){
    alert("QR non généré");
    return;
  }
  const w = window.open("");
  w.document.write(`<img src="${L.qr_url}" style="max-width:100%;"/>`);
}

// ---------- Photo sanitaire upload ----------
async function uploadPhotoForLine(lineId){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const path = `achats/${achatId}/lignes/${lineId}/sanitaire-${Date.now()}.jpg`;
    const sref = storageRef(storage, path);
    await uploadBytes(sref, file);
    const url = await getDownloadURL(sref);
    await setDoc(doc(linesCol, lineId), { photo_url: url, updatedAt: Timestamp.fromDate(new Date()) }, { merge:true });
    const idx = lines.findIndex(x=>x.id===lineId);
    if (idx>=0) lines[idx].photo_url = url;
    alert("✅ Photo sanitaire attachée.");
  };
  input.click();
}

// ---------- Popup Articles ----------
let articlesCache = [];
async function openPopupArticles(lineId){
  focusedLineId = lineId;
  const modal = qs("#popup-articles");
  const tbody = qs("#articles-list");
  const search = qs("#search-articles");
  modal.style.display = "block";

  if (articlesCache.length === 0){
    const snap = await getDocs(collection(db,"articles"));
    snap.forEach(d => {
      const a = d.data();
      articlesCache.push({ id: d.id, plu: a.PLU||a.plu||d.id, designation: a.Designation||a.designation||"", nomLatin: a.NomLatin||a.nomLatin||"", categorie: a.Categorie||a.categorie||"" });
    });
  }

  function render(filter=""){
    const q = filter.toLowerCase();
    const rows = articlesCache.filter(a => (`${a.plu} ${a.designation}`).toLowerCase().includes(q));
    tbody.innerHTML = rows.map(a => `
      <tr data-plu="${a.plu}" data-des="${a.designation}">
        <td>${a.plu}</td><td>${a.designation}</td><td>${a.nomLatin||""}</td><td>${a.categorie||""}</td>
      </tr>
    `).join("") || `<tr><td colspan="4">Aucun article.</td></tr>`;

    tbody.querySelectorAll("tr[data-plu]").forEach(tr => {
      tr.addEventListener("dblclick", () => {
        if (!focusedLineId) return;
        const plu = tr.getAttribute("data-plu");
        const des = tr.getAttribute("data-des");
        // injecte dans la ligne
        const row = qs(`tr[data-id="${focusedLineId}"]`);
        row.querySelector(".plu").value = plu;
        row.querySelector(".designation").value = des;
        saveLine(focusedLineId);
        closePopup();
      });
    });
  }

  render();
  search.oninput = () => render(search.value);
  qs("#btnClosePopup").onclick = closePopup;
}

function closePopup(){
  qs("#popup-articles").style.display = "none";
}

// ---------- Bind header buttons ----------
function bindHeader(){
  qs("#btnSaveHeader").addEventListener("click", saveHeader);
  qs("#btnAddLine").addEventListener("click", addLine);
  qs("#btnConvertBL").addEventListener("click", convertToBL);
}

// ---------- Init ----------
window.addEventListener("DOMContentLoaded", async () => {
  bindHeader();
  await loadAchat();
});
