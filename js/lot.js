import { db } from "./firebase-init.js";
import {
  doc, getDoc, collection, query, where, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ---------- Utils ----------
function qs(s) { return document.querySelector(s); }
function fmt(d) {
  if (!d) return "";
  const x = d.toDate ? d.toDate() : new Date(d);
  return x.toLocaleDateString('fr-FR');
}

// ---------- Get lotId from URL ----------
const urlParams = new URLSearchParams(window.location.search);
const lotId = urlParams.get("lot");

if (!lotId) {
  qs("#lot-info").innerText = "Lot introuvable.";
  throw new Error("Missing lot param");
}

// ---------- Load LOT ----------
async function loadLot() {
  const ref = doc(db, "lots", lotId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    qs("#lot-info").innerText = "Lot introuvable.";
    return;
  }

  const d = snap.data();

  // === Bloc info ===
  qs("#lot-info").innerHTML = `
    <div class="title">LOT ${lotId}</div>
    <div class="subtitle">${d.plu} – ${d.designation}</div>

    <div class="row"><span>Poids initial :</span> ${d.poidsInitial} kg</div>
    <div class="row"><span>Poids restant :</span> ${d.poidsRestant} kg</div>
    <div class="row"><span>Prix HT/kg :</span> ${d.prixAchatKg} €</div>
    <div class="row"><span>DLC :</span> ${fmt(d.dlc)}</div>

    <div class="row"><span>Zone :</span> ${d.zone || "-"}</div>
    <div class="row"><span>Sous-zone :</span> ${d.sousZone || "-"}</div>
    <div class="row"><span>Engin :</span> ${d.engin || "-"}</div>

    <div class="row"><span>Achat :</span> ${d.achatId}</div>
    <div class="row"><span>Ligne :</span> ${d.ligneId}</div>
  `;

  // === Photo sanitaire ===
  if (d.photo_url) {
    qs("#lot-photo").innerHTML = `
      <div class="title">Étiquette sanitaire</div>
      <img src="${d.photo_url}" class="photo">
    `;
  } else {
    qs("#lot-photo").innerHTML = `<i>Aucune photo enregistrée</i>`;
  }
}

// ---------- Load movements ----------
async function loadMovements() {
  const col = collection(db, "stock_movements");
  const q = query(col,
    where("lotId", "==", lotId),
    orderBy("date", "asc")
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    qs("#movement-list").innerHTML = "<i>Aucun mouvement pour ce lot.</i>";
    return;
  }

  let html = "";
  snap.forEach(doc => {
    const m = doc.data();

    html += `
      <div class="movement">
        <b>${fmt(m.date)}</b> — ${m.type}<br>
        Mouvement : <b>${m.poids} kg</b><br>
        Poids restant : <b>${m.poidsRestant} kg</b>
      </div>
    `;
  });

  qs("#movement-list").innerHTML = html;
}

// ---------- Run ----------
loadLot();
loadMovements();
