import { app, db } from "../js/firebase-init.js";
import {
  doc, getDoc, updateDoc, setDoc, collection, addDoc,
  getDocs, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const storage = getStorage(app);

// === utils ==================================================
function focusNextInput(tr, fromClass){
  const inputs = Array.from(tr.querySelectorAll("input.inp"));
  const idx = inputs.findIndex(x => x.classList.contains(fromClass));
  if (idx >= 0 && inputs[idx+1]) {
    inputs[idx+1].focus();
    inputs[idx+1].select?.();
  }
}

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
let articlesCache = [];

// ---------- Load achat + lines ----------
async function loadAchat(){
  const snap = await getDoc(achatRef);
  if (!snap.exists()){
    alert("Achat introuvable.");
    return;
  }
  currentAchat = snap.data();

  // header -> UI
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
        <td><input class="inp colis" type="number" step="1" min="0" value="${nz(r.colis)}" /></td>
        <td><input class="inp pcolis" type="number" step="0.001" min="0" value="${nz(r.poidsColisKg)}" /></td>
        <td><input class="inp ptotal" type="number" step="0.001" min="0" value="${nz(r.poidsTotalKg)}" /></td>
        <td><input class="inp prixkg" type="number" step="0.01" min="0" value="${nz(r.prixKg)}" /></td>
        <td><input class="inp mht" type="number" step="0.01" min="0" value="${nz(r.montantHT)}" /></td>
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
  }).join("") || `<tr><td colspan="11">Aucune ligne.</td></tr>`;

  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const get = (sel) => tr.querySelector(sel);

    tr.addEventListener("focusin", () => { focusedLineId = id; });

    // ENTER navigation
    tr.querySelectorAll("input.inp").forEach((inp, colIdx) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        saveLine(id).then(async () => {
          const trs = qsa("#achat-lines tr");
          const rowIdx = trs.findIndex(x => x.getAttribute("data-id") === id);
          let nextTr = trs[rowIdx+1];
          if (!nextTr) {
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

    // Auto-calc prix/poids
    const onCalc = async () => {
      const colis = toNum(get(".colis")?.value);
      const pcolis = toNum(get(".pcolis")?.value);
      let ptotal = toNum(get(".ptotal")?.value);
      if (colis && pcolis) ptotal = +(colis * pcolis).toFixed(3);
      const prixkg = toNum(get(".prixkg")?.value);
      const mht = +(ptotal * prixkg).toFixed(2);
      get(".ptotal").value = isNaN(ptotal) ? "" : String(ptotal);
      get(".mht").value = isNaN(mht) ? "" : String(mht);
      await saveLine(id);
      recomputeTotals();
    };

    ["change","blur"].forEach(ev=>{
      get(".colis")?.addEventListener(ev,onCalc);
      get(".pcolis")?.addEventListener(ev,onCalc);
      get(".ptotal")?.addEventListener(ev,onCalc);
      get(".prixkg")?.addEventListener(ev,onCalc);
      get(".mht")?.addEventListener(ev,async()=>{ await saveLine(id); recomputeTotals(); });
      get(".designation")?.addEventListener(ev,()=>saveLine(id));
    });

    // ✅ AUTO TRACA PLU — écouteur propre (hors forEach)
  const inpPLU = get(".plu");
inpPLU?.addEventListener("change", async () => {
  await saveLine(id);
  await autofillTraceFromPLU(id);

  // ✅ Mise à jour locale sans re-render
  // (on ne touche pas renderLines ici)
  const idx = lines.findIndex(x => x.id === id);
  if (idx >= 0) {
    lines[idx] = { ...lines[idx] };
  }

  focusNextInput(tr, "plu");
});


    // Inline pills
    tr.querySelectorAll(".pill")
      .forEach(p => p.addEventListener("click", () => startInlineEditPill(id,p)));

    // F9 popup
    get(".btn-article")?.addEventListener("click",()=>openPopupArticles(id));
    tr.addEventListener("keydown",(e)=>{ if(e.key==="F9"){ e.preventDefault(); openPopupArticles(id);} });

    // AF MAP
    get(".btn-afmap")?.addEventListener("click",()=>applyAFMapForLine(id));

    // QR
    get(".btn-qr")?.addEventListener("click",()=>openQRForLine(id));

    // PHOTO
    get(".btn-photo")?.addEventListener("click",()=>uploadPhotoForLine(id));

    // del
    get(".btn-del")?.addEventListener("click", async()=>{
      if(!confirm("Supprimer cette ligne ?")) return;
      await deleteLine(id);
    });
  });
}

/* 🟦  le reste du fichier inchangé — il tient déjà dans ton message
   ✅ inline edit
   ✅ saveLine
   ✅ deleteLine
   ✅ addLine
   ✅ recomputeTotals
   ✅ saveHeader
   ✅ convertToBL
   ✅ ensureQRForLine
   ✅ openQR
   ✅ uploadPhoto
   ✅ autofillTraceFromPLU
   ✅ AF MAP
   ✅ popup articles
   ✅ bindHeader
*/

window.addEventListener("DOMContentLoaded", async () => {
  bindHeader();
  await loadAchat();
});
