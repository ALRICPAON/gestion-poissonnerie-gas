/******************************************************
 *  INVENTAIRE – VERSION FINALE FIFO
 *  Source stock : LOTS
 *  Source ventes : CA via inventaire-import.js (localStorage)
 *  Validation : applyInventory(plu, poidsReel, user)
 *****************************************************/


import { db, auth } from "./firebase-init.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { applyInventory } from "../js/apply-inventory.js";

// ---- Elements HTML ---- //
const btnCharger = document.querySelector("#btnCharger");
const btnValider = document.querySelector("#btnValider");
const tbody = document.querySelector("#inv-list");
const valideStatus = document.querySelector("#valideStatus");

let dataInventaire = [];  // mémoire interne

//--------------------------------------------------------
// 🔹 Fonction utilitaire formatage 2 décimales
//--------------------------------------------------------
function n2(v) {
  return Number(v || 0).toFixed(2);
}

//--------------------------------------------------------
// 🔥 1. CHARGER INVENTAIRE
//--------------------------------------------------------
async function chargerInventaire() {

  const ventes = JSON.parse(localStorage.getItem("inventaireCA") || "{}");
  tbody.innerHTML = "<tr><td colspan='9'>⏳ Chargement…</td></tr>";

  // ---- 1. Charger TOUS les lots encore ouverts ----
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

  // ---- 2. Charger prix de vente réel (stock_articles) ----
  const snapStockArticles = await getDocs(collection(db, "stock_articles"));
  const prixVente = {}; // plu → prix TTC / kg

  snapStockArticles.forEach(sa => {
    const d = sa.data();
    const plu = d.PLU || sa.id.replace("PLU_", "");
    prixVente[plu] = d.pvTTCreel || 0;
  });

  // ---- 3. Construction du tableau ----
  const rows = [];
  dataInventaire = []; // reset

  for (const plu of Object.keys(regroup)) {

    const stockTheo = regroup[plu].stockTheo;
    const lots = regroup[plu].lots;
    const designation = regroup[plu].designation;

    // récupération EAN depuis article
    const artSnap = await getDoc(doc(db, "articles", plu));
    const ean = artSnap.exists() ? artSnap.data().ean : null;

    const caTTC = ean && ventes[ean] ? ventes[ean] : 0;
    const prixKg = prixVente[plu] || 0;

    // poids vendu = CA TTC / prix TTC
    const poidsVendu = (prixKg > 0) ? caTTC / prixKg : 0;

    // stock réel = stock théorique - vendu
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
// 🔧 A. BOUTON AJUSTER (saisie manuelle du poids réel)
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
// 🔥 2. VALIDATION INVENTAIRE → FIFO
//--------------------------------------------------------
btnValider.addEventListener("click", async () => {

  if (!confirm("Valider l’inventaire et appliquer FIFO sur les lots ?")) return;

  valideStatus.textContent = "⏳ Application FIFO…";

  const user = auth.currentUser ? auth.currentUser.email : "inconnu";

  for (const item of dataInventaire) {
    await applyInventory(item.plu, item.stockReel, user);
  }

  valideStatus.textContent = "✅ Inventaire appliqué avec succès !";
  alert("Inventaire validé.");
});

//--------------------------------------------------------
// 🔥 3. CHARGER L’INVENTAIRE AU CLIC
//--------------------------------------------------------
btnCharger.addEventListener("click", chargerInventaire);
window.addEventListener("inventaireCAReady", () => {
  chargerInventaire();
});
