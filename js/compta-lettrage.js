import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const el = {
  fourSelect:  document.getElementById("fourSelect"),
  factDate:    document.getElementById("factDate"),
  factNumero:  document.getElementById("factNumero"),
  factHT:      document.getElementById("factHT"),
  factHTReel:  document.getElementById("factHTReel"),
  ecartNote:   document.getElementById("ecartNote"),
  btnCharger:  document.getElementById("btnCharger"),
  filterMode:  document.getElementById("filterMode"),
  achatsBody:  document.getElementById("achatsBody"),
  sumFactHT:   document.getElementById("sumFactHT"),
  sumPointeHT: document.getElementById("sumPointeHT"),
  sumEcartHT:  document.getElementById("sumEcartHT"),
  btnValider:  document.getElementById("btnValider"),
  status:      document.getElementById("status"),

  popup:       document.getElementById("popup-lines"),
  popupTitle:  document.getElementById("popupTitle"),
  linesBody:   document.getElementById("linesBody"),
  popupClose:  document.getElementById("popupClose"),
  popupApply:  document.getElementById("popupApply"),
};

let achatsCache = [];       // achats chargés
let selection = new Map();  // achatId -> {full:boolean, lines:Set(lineId), totalHT:number}
let currentPopupAchat = null;

const n2 = v => Number(v||0).toFixed(2);

// 🔥 parse robuste (virgule -> point)
function toNum(v) {
  if (v == null) return 0;
  const s = String(v).replace(/\s/g,"").replace(",",".");
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
}

// ---------------------------
// Charger fournisseurs (liste)
// ---------------------------
async function loadFournisseurs() {
  const snap = await getDocs(collection(db, "fournisseurs"));
  const opts = [];
  snap.forEach(d => {
    const r = d.data();
    const code = r.code || r.Code || r.fournisseurCode || r.FournisseurCode || d.id;
    const nom  = r.nom || r.Nom || r.raisonSociale || r.RaisonSociale || "";
    opts.push({ code, nom });
  });

  opts.sort((a,b)=> (a.nom||"").localeCompare(b.nom||""));

  el.fourSelect.innerHTML =
    `<option value="">-- Choisir --</option>` +
    opts.map(o => `<option value="${o.code}">${o.code} — ${o.nom}</option>`).join("");
}

// ---------------------------
// Charger achats du fournisseur
// ---------------------------
async function loadAchatsForFournisseur() {
  const fourCode = el.fourSelect.value;
  if (!fourCode) return alert("Choisis un fournisseur.");

  el.achatsBody.innerHTML = `<tr><td colspan="6">Chargement…</td></tr>`;
  selection.clear();

  const snapAchats = await getDocs(
    query(collection(db, "achats"), where("fournisseurCode", "==", fourCode))
  );

  achatsCache = [];
  snapAchats.forEach(d => {
    const r = d.data();
    achatsCache.push({
      id: d.id,
      date: r.date || r.dateAchat || r.createdAt || null,
      totalHT: toNum(r.totalHT || r.montantHT || r.total || 0),
      numero: r.numero || r.numBL || d.id,
      factureId: r.factureId || null,
    });
  });

  renderAchats();
  refreshSummary();
}

function fmtDate(v) {
  if (!v) return "";
  const d = v.toDate ? v.toDate() : (v instanceof Date ? v : null);
  if (!d) return "";
  return d.toLocaleDateString("fr-FR");
}

// ---------------------------
// Render tableau achats
// ---------------------------
function renderAchats() {
  const mode = el.filterMode.value; // all | open
  let list = achatsCache;

  if (mode === "open") {
    list = list.filter(a => !a.factureId);
  }

  if (list.length === 0) {
    el.achatsBody.innerHTML = `<tr><td colspan="6">Aucun achat à afficher.</td></tr>`;
    return;
  }

  el.achatsBody.innerHTML = list.map(a => {
    const already = !!a.factureId;
    const checked = selection.get(a.id)?.full ? "checked" : "";
    return `
      <tr data-id="${a.id}">
        <td>${fmtDate(a.date)}</td>
        <td>${a.numero}</td>
        <td>${n2(a.totalHT)} €</td>
        <td>
          <input type="checkbox" class="chk-full" ${checked} ${already ? "disabled" : ""}>
        </td>
        <td>
          <span class="link btn-lines" ${already ? 'style="opacity:.4;pointer-events:none;"' : ""}>
            Voir lignes
          </span>
        </td>
        <td>${already ? "✅" : ""}</td>
      </tr>
    `;
  }).join("");

  el.achatsBody.querySelectorAll(".chk-full").forEach(chk => {
    chk.addEventListener("change", onToggleFullAchat);
  });

  el.achatsBody.querySelectorAll(".btn-lines").forEach(btn => {
    btn.addEventListener("click", onOpenLines);
  });
}

// ---------------------------
// Pointer achat complet
// ---------------------------
function onToggleFullAchat(e) {
  const tr = e.target.closest("tr");
  const achatId = tr.dataset.id;
  const achat = achatsCache.find(a => a.id === achatId);
  if (!achat) return;

  if (e.target.checked) {
    selection.set(achatId, {
      full: true,
      lines: new Set(),
      totalHT: toNum(achat.totalHT || 0),
    });
  } else {
    selection.delete(achatId);
  }

  refreshSummary();
}

// ---------------------------
// Popup lignes achat
// ---------------------------
async function onOpenLines(e) {
  const tr = e.target.closest("tr");
  const achatId = tr.dataset.id;
  currentPopupAchat = achatId;

  el.linesBody.innerHTML = `<tr><td colspan="6">Chargement…</td></tr>`;
  el.popup.style.display = "flex";
  el.popupTitle.textContent = `Détail achat ${achatId}`;

  const linesCol = collection(db, "achats", achatId, "lignes");
  const snapLines = await getDocs(linesCol);

  const selectedLines = selection.get(achatId)?.lines || new Set();
  const totalByLine = [];

  snapLines.forEach(d => {
    const r = d.data();
    const lineId = d.id;
    const plu = r.plu || r.PLU || "";
    const des = r.designation || r.Designation || "";
    const poids = toNum(r.poidsTotalKg || r.poids || 0);
    const prix = toNum(r.prixKg || r.prix || 0);
    const mht = toNum(r.montantHT || (poids * prix) || 0);

    totalByLine.push({ lineId, plu, des, poids, prix, mht, checked: selectedLines.has(lineId) });
  });

  el.linesBody.innerHTML = totalByLine.map(l => `
    <tr data-line="${l.lineId}" data-mht="${n2(l.mht)}">
      <td>${l.plu}</td>
      <td>${l.des}</td>
      <td>${n2(l.poids)}</td>
      <td>${n2(l.prix)}</td>
      <td>${n2(l.mht)} €</td>
      <td><input type="checkbox" class="chk-line" ${l.checked ? "checked":""}></td>
    </tr>
  `).join("");
}

// ---------------------------
// Appliquer sélection lignes
// ---------------------------
function applyLinesSelection() {
  const achatId = currentPopupAchat;
  if (!achatId) return;

  const checkedLines = new Set();
  let totalHT = 0;

  el.linesBody.querySelectorAll("tr").forEach(tr => {
    const lineId = tr.dataset.line;
    const chk = tr.querySelector(".chk-line");
    if (chk && chk.checked) {
      checkedLines.add(lineId);
      totalHT += toNum(tr.dataset.mht);
    }
  });

  if (checkedLines.size === 0) {
    selection.delete(achatId);
  } else {
    selection.set(achatId, {
      full: false,
      lines: checkedLines,
      totalHT,
    });
  }

  el.popup.style.display = "none";
  currentPopupAchat = null;
  renderAchats();
  refreshSummary();
}

// ---------------------------
// Résumé + écart
// ---------------------------
function refreshSummary() {
  const factHT = toNum(el.factHT.value || 0);
  const totalPointe = [...selection.values()].reduce((s,x)=> s + toNum(x.totalHT||0), 0);

  el.sumFactHT.textContent = n2(factHT);
  el.sumPointeHT.textContent = n2(totalPointe);

  // si facture réel vide → on propose = facture HT
  if (el.factHTReel.value === "" || el.factHTReel.value == null) {
    el.factHTReel.value = n2(factHT);
  }

  const factHTReel = toNum(el.factHTReel.value || factHT);
  const ecart = factHTReel - totalPointe;
  el.sumEcartHT.textContent = n2(ecart);
}

// ---------------------------
// Valider facture lettrée
// + marque les achats comme pointés
// ---------------------------
async function validerFacture() {
  const user = auth.currentUser;
  if (!user) return alert("Non connecté.");

  const fourCode = el.fourSelect.value;
  if (!fourCode) return alert("Choisis un fournisseur.");

  const date = el.factDate.value;
  const numero = (el.factNumero.value || "").trim();
  const factHT = toNum(el.factHT.value || 0);
  const factHTReel = toNum(el.factHTReel.value || factHT);

  if (!date) return alert("Choisis une date de facture.");
  if (!numero) return alert("Saisis un numéro de facture.");
  if (factHT <= 0) return alert("Montant facture HT invalide.");

  const totalPointe = [...selection.values()].reduce((s,x)=> s + toNum(x.totalHT||0), 0);
  const ecart = factHTReel - totalPointe;

  const achatsPointes = [];
  for (const [achatId, sel] of selection.entries()) {
    const achat = achatsCache.find(a => a.id === achatId);
    if (sel.full) {
      achatsPointes.push({
        achatId,
        mode: "full",
        totalHT: sel.totalHT,
        numeroAchat: achat?.numero || achatId
      });
    } else {
      sel.lines.forEach(lineId => {
        achatsPointes.push({ achatId, lineId, mode:"line" });
      });
      achatsPointes.push({ achatId, mode:"line_total", totalHT: sel.totalHT });
    }
  }

  const factureId = `${fourCode}__${numero}`.replace(/\s+/g,"_");

  // 1) créer / maj doc facture
  await setDoc(doc(db, "factures", factureId), {
    userId: user.uid,
    fournisseurCode: fourCode,
    numero,
    date,
    montantFactureHT: factHT,
    montantFournisseurHT: factHTReel,
    totalPointeHT: totalPointe,
    ecartHT: ecart,
    ecartNote: (el.ecartNote.value || "").trim(),
    statut: Math.abs(ecart) < 0.01 ? "OK" : "ECART",
    achatsPointes,
    createdAt: serverTimestamp()
  }, { merge:true });

  // 2) 🔥 marquer les achats comme pointés (pour le filtre)
  for (const achatId of selection.keys()) {
    await updateDoc(doc(db, "achats", achatId), {
      factureId,
      factureNumero: numero,
      factureDate: date,
      factureHT: factHTReel,
      factureEcartHT: ecart,
      facturePointageAt: serverTimestamp()
    });
  }

  // reload cache pour que filtre reflète tout de suite
  achatsCache = achatsCache.map(a =>
    selection.has(a.id) ? { ...a, factureId } : a
  );

  selection.clear();
  renderAchats();
  refreshSummary();

  el.status.textContent =
    `✅ Facture enregistrée (${Math.abs(ecart)<0.01 ? "OK" : "Écart "+n2(ecart)+" €"}).`;

  alert("Facture lettrée enregistrée.");
}

// ---------------------------
// Events
// ---------------------------
el.btnCharger.addEventListener("click", loadAchatsForFournisseur);
el.filterMode.addEventListener("change", () => {
  renderAchats();
});
el.factHT.addEventListener("input", refreshSummary);
el.factHTReel.addEventListener("input", refreshSummary);
el.btnValider.addEventListener("click", validerFacture);

el.popupClose.addEventListener("click", ()=> {
  el.popup.style.display="none";
  currentPopupAchat=null;
});
el.popupApply.addEventListener("click", applyLinesSelection);

// init
loadFournisseurs();
