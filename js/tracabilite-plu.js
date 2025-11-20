import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Shortcuts
const qs = (s) => document.querySelector(s);

// Format date
function fmt(d) {
  if (!d) return "";
  const x = d.toDate ? d.toDate() : new Date(d);
  return x.toLocaleDateString('fr-FR');
}

// Input listener
qs("#input-plu").addEventListener("input", (e) => {
  const plu = e.target.value.trim();
  if (plu.length >= 3) loadAll(plu);
});

// ============ LOAD EVERYTHING ============
async function loadAll(plu) {
  loadStock(plu);
  loadAchats(plu);
  loadVentes(plu);
  loadMovements(plu);
}

// =================== STOCK ===================
async function loadStock(plu) {
  const col = collection(db, "lots");
  const q = query(col,
    where("plu", "==", plu),
    where("closed", "==", false),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);
  const el = qs("#stock-block");

  if (snap.empty) {
    el.style.display = "block";
    el.innerHTML = `<div class="title">Stock actuel</div>
    Aucun lot ouvert.`;
    return;
  }

  let html = `<div class="title">Stock actuel</div>`;

  snap.forEach(doc => {
    const d = doc.data();
    html += `
      <div class="row">
        <b>Lot ${doc.id}</b><br>
        ${d.poidsRestant} / ${d.poidsInitial} kg<br>
        DLC : ${fmt(d.dlc)}<br>
        ${d.zone || ""} ${d.sousZone || ""}<br>
        ${d.engin || ""}<br>
        <a class="btn" href="lot.html?lot=${doc.id}">Voir lot</a>
      </div>
      <hr>
    `;
  });

  el.style.display = "block";
  el.innerHTML = html;
}

// =================== ACHATS ===================
async function loadAchats(plu) {
  const achatsCol = collection(db, "achats");
  const achatsSnap = await getDocs(achatsCol);

  const el = qs("#achats-block");
  let html = `<div class="title">Achats</div>`;
  let found = false;

  for (const achat of achatsSnap.docs) {
    const id = achat.id;
    const lignesCol = collection(db, `achats/${id}/lignes`);

    const q = query(lignesCol, where("plu", "==", plu));
    const lignesSnap = await getDocs(q);

    lignesSnap.forEach(l => {
      found = true;
      const d = l.data();

      html += `
        <div class="row">
          <b>Lot ${d.lotId}</b><br>
          Poids : ${d.poidsKg} kg<br>
          Prix : ${d.prixHTKg} €/kg<br>
          DLC : ${fmt(d.dlc)}<br>
          ${d.zone || ""} ${d.sousZone || ""}<br>
          ${d.engin || ""}<br>
          ${d.photo_url ? `<img src="${d.photo_url}" class="mini-photo">` : ""}
        </div>
        <hr>
      `;
    });
  }

  if (!found) html += `<i>Aucun achat trouvé</i>`;

  el.style.display = "block";
  el.innerHTML = html;
}

// =================== VENTES ===================
async function loadVentes(plu) {
  const el = qs("#ventes-block");

  // CA importé dans inventaireCA
  const snap = await getDocs(collection(db, "inventaireCA"));
  let html = `<div class="title">Ventes (poids estimé via CA)</div>`;
  let totalVendu = 0;

  snap.forEach(doc => {
    const d = doc.data();
    if (d.plu == plu) {
      html += `
        <div class="row">
          ${fmt(d.date)} : ${d.poidsVendu} kg
        </div>
      `;
      totalVendu += d.poidsVendu;
    }
  });

  html += `<div class="row"><b>Total vendu :</b> ${totalVendu} kg</div>`;

  el.style.display = "block";
  el.innerHTML = html;
}

// =================== MOUVEMENTS FIFO ===================
async function loadMovements(plu) {
  const col = collection(db, "stock_movements");
  const q = query(col, where("plu", "==", plu), orderBy("date", "asc"));
  const snap = await getDocs(q);

  const el = qs("#mouvements-block");
  let html = `<div class="title">Mouvements FIFO</div>`;

  if (snap.empty) {
    html += `<i>Aucun mouvement</i>`;
  } else {
    snap.forEach(doc => {
      const m = doc.data();
      html += `
        <div class="movement">
          <b>${fmt(m.date)}</b> — ${m.type}<br>
          ${m.poids > 0 ? "+" : ""}${m.poids} kg<br>
          Lot : ${m.lotId}<br>
          Poids restant : ${m.poidsRestant} kg
        </div>
      `;
    });
  }

  el.style.display = "block";
  el.innerHTML = html;
}
