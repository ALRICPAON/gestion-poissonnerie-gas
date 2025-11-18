import { db } from "../js/firebase-init.js";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const colRef = collection(db, "achats");

const el = {
  tbody: document.getElementById("achats-list"),
  from:  document.getElementById("filterFrom"),
  to:    document.getElementById("filterTo"),
  q:     document.getElementById("filterQuery"),
  btnApply: document.getElementById("btnApplyFilters"),
  btnReset: document.getElementById("btnResetFilters"),
};

function fmtDate(d) {
  if (!d) return "";
  const x = d instanceof Date ? d : (d.toDate ? d.toDate() : null);
  if (!x) return "";
  return x.toLocaleDateString("fr-FR");
}

function fmtMoney(v) {
  const n = Number(v || 0);
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

async function loadAchats() {
  el.tbody.innerHTML = `<tr><td colspan="8">Chargement…</td></tr>`;

  let qRef;
  const hasFrom = !!el.from.value;
  const hasTo   = !!el.to.value;

  if (hasFrom || hasTo) {
    const start = hasFrom ? new Date(el.from.value + "T00:00:00") : new Date("1970-01-01");
    const end   = hasTo   ? new Date(el.to.value   + "T23:59:59") : new Date("2999-12-31");

    qRef = query(
      colRef,
      where("date", ">=", Timestamp.fromDate(start)),
      where("date", "<=", Timestamp.fromDate(end)),
      orderBy("date", "desc"),
    );
  } else {
    qRef = colRef;
  }

  const snap = await getDocs(qRef);
  let rows = [];

  snap.forEach(docSnap => {
    const r = docSnap.data();

    let d = r.date;
    if (d?.toDate) d = d.toDate();
    else if (typeof d === "string") d = new Date(d);
    else d = null;

    rows.push({
      id: docSnap.id,
      date: d,
      fournisseurNom: r.fournisseurNom || "",
      designationFournisseur: r.designationFournisseur || "",
      type: r.type || "commande",
      statut: r.statut || "new",
      montantHT: r.montantHT || 0,
      montantTTC: r.montantTTC || 0,
      updatedAt: r.updatedAt || r.date
    });
  });

  if (!hasFrom && !hasTo) {
    rows.sort((a,b) => {
      const da = (a.updatedAt?.toDate ? a.updatedAt.toDate() : a.updatedAt) || 0;
      const db = (b.updatedAt?.toDate ? b.updatedAt.toDate() : b.updatedAt) || 0;
      return db - da;
    });
  }

  const qtxt = (el.q.value || "").toLowerCase();
  if (qtxt) {
    rows = rows.filter(r =>
      `${r.fournisseurNom} ${r.designationFournisseur}`.toLowerCase().includes(qtxt)
    );
  }

  el.tbody.innerHTML = rows.map(r => {
    const href = `./achat-detail.html?id=${encodeURIComponent(r.id)}`;
    const typeLabel = r.type === "BL" ? "BL" : "Commande";

    return `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td>${r.fournisseurNom}</td>
        <td>${r.designationFournisseur}</td>
        <td><span class="badge ${r.type==='BL'?'badge-blue':'badge-muted'}">${typeLabel}</span></td>
        <td>${fmtMoney(r.montantHT)}</td>
        <td>${fmtMoney(r.montantTTC)}</td>
        <td><span class="badge">${r.statut}</span></td>
        <td>
          <button class="btn btn-small" onclick="location.href='${href}'">Ouvrir</button>
          <button class="btn btn-small btn-danger btn-del" data-id="${r.id}">🗑️</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="8">Aucun achat</td></tr>`;

  // 🗑️ Suppression achat
  document.querySelectorAll(".btn-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const achatId = btn.dataset.id;
      if (!confirm("🗑️ Supprimer cet achat ainsi que toutes ses lignes ?")) return;

      try {
        await deleteDoc(doc(db, "achats", achatId));

        const lignesCol = collection(db, "achats", achatId, "lignes");
        const snap = await getDocs(lignesCol);

        for (const d of snap.docs) {
          await deleteDoc(doc(lignesCol, d.id));
        }

        alert("👍 Achat supprimé.");
        loadAchats();
      } catch (e) {
        console.error(e);
        alert("❌ Erreur suppression : " + e.message);
      }
    });
  });
}

// ----- Filtres -----
function bindFilters() {

  if (el.btnApply) el.btnApply.addEventListener("click", loadAchats);

  if (el.btnReset) el.btnReset.addEventListener("click", () => {
    el.from.value = "";
    el.to.value = "";
    el.q.value = "";
    loadAchats();
  });

  if (el.q) el.q.addEventListener("input", () => {
    const q = el.q.value.toLowerCase();
    document.querySelectorAll("#achats-list tr").forEach(tr => {
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(q) ? "" : "none";
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  bindFilters();
  loadAchats();
});

window.__reloadAchats = loadAchats;

/********************************************************************
 * 📌 POPUP FOURNISSEURS — Création d’une COMMANDE
 ********************************************************************/
import {
  collection as _collection,
  getDocs as _getDocs,
  addDoc as _addDoc,
  Timestamp as _Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db as _db } from "../js/firebase-init.js";

const popup = document.getElementById("popup-fournisseurs");
const list  = document.getElementById("fourn-list");
const search= document.getElementById("fourn-search");
const btnNewCommande = document.getElementById("btnNewCommande");

// 🔥 1. OUVERTURE POPUP
btnNewCommande.addEventListener("click", openFournPopup);

async function openFournPopup() {
  const snap = await _getDocs(_collection(_db, "fournisseurs"));

  window.__fournisseurs = [];
  list.innerHTML = "";

  snap.forEach(d => {
    const f = d.data();
    window.__fournisseurs.push({
      id: d.id,
      code: f.Code || f.code || "",
      nom: f.Nom || f.nom || "",
      libelle: f.Designation || f.designation || ""
    });
  });

  renderFournList(window.__fournisseurs);
  popup.style.display = "flex";
}

// 🔥 2. AFFICHAGE LISTE
function renderFournList(arr) {
  list.innerHTML = arr.map(f => `
    <tr data-id="${f.id}" data-code="${f.code}" data-nom="${f.nom}" data-des="${f.libelle}">
      <td><strong>${f.code}</strong></td>
      <td>${f.nom}</td>
      <td>${f.libelle}</td>
    </tr>
  `).join("") || `<tr><td colspan="3">Aucun fournisseur</td></tr>`;

  document.querySelectorAll("#fourn-list tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => selectFourn(tr));
  });
}

// 🔥 3. FILTRE LIVE
search.addEventListener("input", () => {
  const q = search.value.toLowerCase();
  const filtered = window.__fournisseurs.filter(f =>
    `${f.code} ${f.nom} ${f.libelle}`.toLowerCase().includes(q)
  );
  renderFournList(filtered);
});

// 🔥 4. VALIDATION → CRÉATION ACHAT
async function selectFourn(tr) {
  const code = tr.dataset.code;
  const nom  = tr.dataset.nom;
  const des  = tr.dataset.des;

  const ref = await _addDoc(_collection(_db, "achats"), {
    date: _Timestamp.now(),
    fournisseurCode: code,
    fournisseurNom: nom,
    designationFournisseur: des,
    type: "commande",        // <--- très important
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    createdAt: _Timestamp.now(),
    updatedAt: _Timestamp.now()
  });

  popup.style.display = "none";

  // Redirection
  location.href = `/pages/achat-detail.html?id=${ref.id}`;
}

// 🔥 5. FERMETURE POPUP
document.getElementById("fourn-close").addEventListener("click", () => {
  popup.style.display = "none";
});

/********************************************************************
 * 📌 POPUP FOURNISSEURS — Création d’un B L
 ********************************************************************/
const btnNewBL = document.getElementById("btnNewBL");

btnNewBL.addEventListener("click", openFournPopupBL);

async function openFournPopupBL() {
  const snap = await _getDocs(_collection(_db, "fournisseurs"));

  window.__fournisseursBL = [];
  list.innerHTML = "";

  snap.forEach(d => {
    const f = d.data();
    window.__fournisseursBL.push({
      id: d.id,
      code: f.Code || f.code || "",
      nom: f.Nom || f.nom || "",
      libelle: f.Designation || f.designation || ""
    });
  });

  renderFournListBL(window.__fournisseursBL);
  popup.style.display = "flex";
}

// 🔥 Rendu liste BL
function renderFournListBL(arr) {
  list.innerHTML = arr.map(f => `
    <tr data-id="${f.id}" data-code="${f.code}" data-nom="${f.nom}" data-des="${f.libelle}" data-type="BL">
      <td><strong>${f.code}</strong></td>
      <td>${f.nom}</td>
      <td>${f.libelle}</td>
    </tr>
  `).join("") || `<tr><td colspan="3">Aucun fournisseur</td></tr>`;

  document.querySelectorAll("#fourn-list tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => selectFournBL(tr));
  });
}

// 🔥 Création achat BL
async function selectFournBL(tr) {
  const code = tr.dataset.code;
  const nom  = tr.dataset.nom;
  const des  = tr.dataset.des;

  const ref = await _addDoc(_collection(_db, "achats"), {
    date: _Timestamp.now(),
    fournisseurCode: code,
    fournisseurNom: nom,
    designationFournisseur: des,
    type: "BL",
    statut: "received",
    montantHT: 0,
    montantTTC: 0,
    createdAt: _Timestamp.now(),
    updatedAt: _Timestamp.now()
  });

  popup.style.display = "none";

  // Redirection
  location.href = `/pages/achat-detail.html?id=${ref.id}`;
}

