import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const qs = s => document.querySelector(s);
const fmt = d => (d?.toDate ? d.toDate().toLocaleDateString("fr-FR") : "");

qs("#input-plu").addEventListener("input", e => {
  const plu = e.target.value.trim();
  if (plu.length >= 3) loadPLU(plu);
});

async function loadPLU(plu) {
  loadStock(plu);
  loadAchats(plu);
  loadMovements(plu);
}

// 🟢 STOCK ACTUEL
async function loadStock(plu) {
  const ref = query(
    collection(db,"lots"),
    where("plu","==",plu),
    where("closed","==",false),
    orderBy("createdAt","asc")
  );
  const snap = await getDocs(ref);

  const el = qs("#stock");
  el.innerHTML = `<div class="card-title">Stock actuel</div>`;
  el.style.display = "block";

  if (snap.empty) {
    el.innerHTML += `<div>Aucun lot ouvert</div>`;
    return;
  }

  snap.forEach(doc => {
    const d = doc.data();
    el.innerHTML += `
      <div class="item">
        <b>Lot ${doc.id}</b><br>
        Restant : ${d.poidsRestant} kg<br>
        DLC : ${fmt(d.dlc)}<br>
        FAO : ${d.zone || ""} ${d.sousZone || ""}<br>
        Engin : ${d.engin || ""}<br>
        ${d.photo_url ? `<img class="mini-photo" src="${d.photo_url}">` : ""}
        <br><a class="btn" href="lot.html?lot=${doc.id}">Voir le lot</a>
      </div>`;
  });
}

// 🟡 ACHATS – ORIGINE
async function loadAchats(plu) {
  const el = qs("#achats");
  el.innerHTML = `<div class="card-title">Achats</div>`;
  el.style.display = "block";

  let found = false;

  const achats = await getDocs(collection(db,"achats"));
  for (const a of achats.docs) {
    const lignes = await getDocs(
      query(collection(db,`achats/${a.id}/lignes`), where("plu","==",plu))
    );

    lignes.forEach(l => {
      found = true;
      const d = l.data();
      el.innerHTML += `
        <div class="item">
          <b>Achat du ${fmt(d.createdAt)}</b><br>
          Poids : ${d.poidsKg} kg — Prix : ${d.prixHTKg} €/kg<br>
          Lot : ${d.lotId}<br>
          FAO : ${d.zone || ""} ${d.sousZone || ""}<br>
          Engin : ${d.engin || ""}<br>
          ${d.photo_url ? `<img class="mini-photo" src="${d.photo_url}">` : ""}
        </div>`;
    });
  }

  if (!found) {
    el.innerHTML += `<div>Aucun achat trouvé</div>`;
  }
}

// 🔴 FIFO – CONSOMMATIONS & VENTES
async function loadMovements(plu) {
  const ref = query(
    collection(db,"stock_movements"),
    where("plu","==",plu),
    orderBy("date","asc")
  );
  const snap = await getDocs(ref);

  const el = qs("#moves");
  el.innerHTML = `<div class="card-title">Mouvements</div>`;
  el.style.display = "block";

  if (snap.empty) {
    el.innerHTML += `<div>Aucun mouvement</div>`;
    return;
  }

  snap.forEach(m => {
    const d = m.data();
    el.innerHTML += `
      <div class="item">
        <b>${fmt(d.date)}</b> — ${d.type}<br>
        ${d.poids > 0 ? "+" : ""}${d.poids} kg<br>
        Lot : ${d.lotId}<br>
        Reste : ${d.poidsRestant} kg
      </div>`;
  });
}
