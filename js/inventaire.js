import { db, auth } from "./firebase-init.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  collection, doc, getDocs, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const btnCharger = document.querySelector("#btnCharger");
const btnValider = document.querySelector("#btnValider");
const tbody = document.querySelector("#inv-list");
const valideStatus = document.querySelector("#valideStatus");

let dataInventaire = []; // mémoire locale

function to2(n) {
  return Number(n || 0).toFixed(2);
}

async function chargerInventaire() {
  const ventes = JSON.parse(localStorage.getItem("inventaireCA") || "{}");

  tbody.innerHTML = "<tr><td colspan='9'>⏳ Chargement…</td></tr>";

  const snapStock = await getDocs(collection(db, "stock_articles"));
  const rows = [];

  dataInventaire = [];

  snapStock.forEach(st => {
    const s = st.data();
    const plu = s.PLU || st.id.replace("PLU_", "");
    const ean = s.ean || null;

    const ca = ventes[ean] || 0;

    const stockTheo = Number(s.poids);
    const prixKg = Number(s.prixTTCkg || 0);

    const poidsVendu = prixKg > 0 ? ca / prixKg : 0;
    const stockReel = Math.max(0, stockTheo - poidsVendu);
    const ecart = stockReel - stockTheo;

    dataInventaire.push({
      docId: st.id,
      plu,
      designation: s.designation || s.Designation || "",
      ean,
      ca,
      stockTheo,
      prixKg,
      poidsVendu,
      stockReel,
      ecart
    });

    rows.push(`
      <tr data-id="${st.id}">
        <td>${plu}</td>
        <td>${s.designation || s.Designation || ''}</td>
        <td>${to2(stockTheo)}</td>
        <td>${to2(prixKg)}</td>
        <td>${to2(ca)}</td>
        <td>${to2(poidsVendu)}</td>
        <td>${to2(stockReel)}</td>
        <td>${to2(ecart)}</td>
        <td>
          <button class="btn btn-muted ajust-btn">Ajuster</button>
        </td>
      </tr>
    `);
  });

  tbody.innerHTML = rows.join("");
}

btnCharger.addEventListener("click", chargerInventaire);

btnValider.addEventListener("click", async () => {
  if (!confirm("Valider l’inventaire et mettre à jour les stocks ?")) return;

  valideStatus.textContent = "⏳ Validation en cours…";

  for (const item of dataInventaire) {
    // 1. MAJ stock_articles
    await updateDoc(doc(db, "stock_articles", item.docId), {
      poids: item.stockReel,
      updatedAt: serverTimestamp()
    });

    // 2. Ajouter un mouvement (sortie)
    await addDoc(collection(db, "stock_movements"), {
      type: "inventory",
      plu: item.plu,
      poidsKg: item.ecart,
      prixKg: item.prixKg,
      designation: item.designation,
      createdAt: serverTimestamp()
    });
  }

  valideStatus.textContent = "✅ Inventaire validé & stock mis à jour !";
  alert("Inventaire validé !");
});
