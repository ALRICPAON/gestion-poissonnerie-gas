/******************************************************
 *  INVENTAIRE – VERSION FINALE FIFO + Mise à jour stock_articles
 *  Source stock : LOTS
 *  Source ventes : CA via inventaire-import.js (localStorage)
 *  Validation : applyInventory(plu, poidsReel, user)
 *****************************************************/

import { db, auth } from "./firebase-init.js";

import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { applyInventory } from "../js/apply-inventory.js";

// ---- Elements HTML ---- //
const btnCharger = document.querySelector("#btnCharger");
const btnValider = document.querySelector("#btnValider");
const tbody = document.querySelector("#inv-list");
const valideStatus = document.querySelector("#valideStatus");

let dataInventaire = [];  // mémoire interne

//--------------------------------------------------------
// Utilitaire
//--------------------------------------------------------
function n2(v) {
  return Number(v || 0).toFixed(2);
}

//--------------------------------------------------------
// 🔥 CHARGER INVENTAIRE
//--------------------------------------------------------
async function chargerInventaire() {

  const ventes = JSON.parse(localStorage.getItem("inventaireCA") || "{}");
  tbody.innerHTML = "<tr><td colspan='9'>⏳ Chargement…</td></tr>";

  // 1. Lire TOUS les lots ouverts
  const snapLots = await getDocs(
    query(collection(db, "lots"), where("closed", "==", false))
  );

  let regroup = {}; // plu → { stockTheo, lots[], designation }

  snapLots.forEach(l => {
    const d = l.data();

    if (!regroup[d.plu]) {
      regroup[d.plu] = {
        plu: d.plu,
        designation: d.designation || "",
        lots: [],
        stockTheo: 0
      };
    }

    regroup[d.plu].stockTheo += d.poidsRestant;
    regroup[d.plu].lots.push({ id: l.id, ...d });
  });

  // 2. Lire prix de vente (stock_articles)
  const snapStockArticles = await getDocs(collection(db, "stock_articles"));
  const prixVente = {}; // plu → prix TTC / kg

  snapStockArticles.forEach(sa => {
    const d = sa.data();
    const plu = d.PLU || sa.id.replace("PLU_", "");
    prixVente[plu] = d.pvTTCreel || 0;
  });

  // 3. Construire tableau
  const rows = [];
  dataInventaire = [];

  for (const plu of Object.keys(regroup)) {

    const stockTheo = regroup[plu].stockTheo;
    const designation = regroup[plu].designation;

    // Récup EAN
    const artSnap = await getDoc(doc(db, "articles", plu));
    const ean = artSnap.exists() ? artSnap.data().ean : null;

    const caTTC = ean && ventes[ean] ? ventes[ean] : 0;
    const prixKg = prixVente[plu] || 0;

    const poidsVendu = (prixKg > 0) ? caTTC / prixKg : 0;

    const stockReel = Math.max(0, stockTheo - poidsVendu);
    const ecart = stockReel - stockTheo;

    dataInventaire.push({
      plu,
      designation,
      stockTheo,
      prixKg,
      caTTC,
      poidsVendu,
      stockReel,
      ecart
    });

    rows.push(`
      <tr>
        <td>${plu}</td>
        <td>${designation}</td>
        <td>${n2(stockTheo)} kg</td>
        <td>${n2(prixKg)} €/kg</td>
        <td>${n2(caTTC)} €</td>
        <td>${n2(poidsVendu)} kg</td>
        <td>${n2(stockReel)} kg</td>
        <td>${n2(ecart)} kg</td>
        <td>
          <button class="btn btn-muted ajust-btn" 
                  data-plu="${plu}" 
                  data-stock="${stockReel}">
            Ajuster
          </button>
        </td>
      </tr>
    `);
  }

  tbody.innerHTML = rows.join("");
  activerBoutonsAjustement();
}

//--------------------------------------------------------
// 🔧 Ajout manuel
//--------------------------------------------------------
function activerBoutonsAjustement() {
  document.querySelectorAll(".ajust-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const plu = btn.dataset.plu;
      const valInit = btn.dataset.stock;
      const nv = prompt(`Poids réel constaté pour PLU ${plu} (kg) :`, valInit);

      if (nv === null) return;

      const ligne = dataInventaire.find(x => x.plu == plu);
      if (!ligne) return;

      ligne.stockReel = Number(nv);
      ligne.ecart = ligne.stockReel - ligne.stockTheo;

      alert("Valeur ajustée ! Elle sera appliquée lors de la validation.");
    });
  });
}

//--------------------------------------------------------
// 🔥 2. VALIDATION INVENTAIRE → FIFO + rebuild stock_articles
//--------------------------------------------------------
btnValider.addEventListener("click", async () => {

  if (!confirm("Valider l’inventaire et appliquer FIFO sur les lots ?")) return;

  valideStatus.textContent = "⏳ Application FIFO…";

  const user = auth.currentUser ? auth.currentUser.email : "inconnu";

  // 1. FIFO sur LES LOTS
  for (const item of dataInventaire) {
    await applyInventory(item.plu, item.stockReel, user);
  }

  //--------------------------------------------------------
  // 2. REBUILD COMPLET DE stock_articles
  //--------------------------------------------------------
  valideStatus.textContent = "⏳ Mise à jour du stock…";

  for (const item of dataInventaire) {

    // Lire les lots restants pour ce PLU
    const lotsSnap = await getDocs(
      query(collection(db, "lots"), where("closed", "==", false), where("plu", "==", item.plu))
    );

    let total = 0;
    lotsSnap.forEach(lot => {
      const d = lot.data();
      total += d.poidsRestant || 0;
    });

    // Mise à jour du stock réel
    await updateDoc(doc(db, "stock_articles", "PLU_" + item.plu), {
      poids: total,
      updatedAt: serverTimestamp()
    });
  }

  //--------------------------------------------------------

  valideStatus.textContent = "✅ Inventaire appliqué + stocks mis à jour !";
  alert("Inventaire validé.");
});

//--------------------------------------------------------
// Bouton charger
//--------------------------------------------------------
btnCharger.addEventListener("click", chargerInventaire);

//--------------------------------------------------------
// Rechargement auto après import CA
//--------------------------------------------------------
window.addEventListener("inventaireCAReady", () => {
  chargerInventaire();
});
