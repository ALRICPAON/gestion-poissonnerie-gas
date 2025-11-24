/******************************************************
 *  INVENTAIRE – VERSION AVANCÉE (FIFO + Tableau Excel)
 *  ✔ Saisie directe dans tableau
 *  ✔ Poids négatifs autorisés
 *  ✔ Choix date inventaire
 *  ✔ Sauvegarde valeur stock HT du jour
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
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { applyInventory } from "../js/apply-inventory.js";

// ---- Elements HTML ---- //
const btnCharger = document.querySelector("#btnCharger");
const btnValider = document.querySelector("#btnValider");
const tbody = document.querySelector("#inv-list");
const valideStatus = document.querySelector("#valideStatus");

// Ajout champ date
const dateInput = document.createElement("input");
dateInput.type = "date";
dateInput.id = "dateInventaire";
dateInput.style = "margin-left:20px;";
btnCharger.insertAdjacentElement("afterend", dateInput);

// 🔥 RESET automatique de l'import CA quand on change la date
dateInput.addEventListener("change", () => {
  localStorage.removeItem("inventaireCA");
  console.log("IMPORT CA RESET (nouvelle date)");
  const s = document.querySelector("#importStatus");
  if (s) s.textContent = "⚠️ Import CA requis pour cette date.";
});

// Mémoire interne
let dataInventaire = [];

//--------------------------------------------------------
// 🔥 EXPANSION PLATEAUX À PARTIR DU CA
// - ventesEAN : { ean: caTTC }
// retourne : { ventesEANNet, extraPoidsByPlu, extraCaByPlu }
//--------------------------------------------------------
async function expandPlateauxFromCA(ventesEAN) {
  const user = auth.currentUser;
  if (!user) return { ventesEANNet: ventesEAN, extraPoidsByPlu: {}, extraCaByPlu: {} };

  // clone pour pouvoir supprimer les ean plateau
  const ventesEANNet = { ...(ventesEAN || {}) };

  // 1) charge tous les plateaux user
  const snapPlateaux = await getDocs(
    query(collection(db, "plateaux"), where("userId", "==", user.uid))
  );

  if (snapPlateaux.empty) {
    return { ventesEANNet, extraPoidsByPlu: {}, extraCaByPlu: {} };
  }

  const extraPoidsByPlu = {}; // plu composant -> kg/pièces vendus via plateaux
  const extraCaByPlu = {};    // ca recalculé pour affichage (optionnel)

  for (const docP of snapPlateaux.docs) {
    const p = docP.data();

    const plateauPlu = String(p.plu || "").trim();
    const pvPlateau  = Number(p.pv || 0);
    const comps      = Array.isArray(p.composants) ? p.composants : [];

    if (!plateauPlu || pvPlateau <= 0 || comps.length === 0) continue;

    // 2) retrouve l’EAN du plateau
    let eanPlateau = p.ean || null;

    if (!eanPlateau) {
      const artSnap = await getDoc(doc(db, "articles", plateauPlu));
      if (artSnap.exists()) eanPlateau = artSnap.data().ean || null;
    }

    if (!eanPlateau) continue;

    const caPlateau = Number(ventesEANNet[eanPlateau] || 0);
    if (caPlateau <= 0) continue;

    // 3) calcule parts vendues
    const parts = caPlateau / pvPlateau;

    // 4) répartit sur les composants
    for (const c of comps) {
      const pluC = String(c.plu || "").trim();
      const qtyC = Number(c.qty || 0);

      if (!pluC || qtyC <= 0) continue;

      const poids = parts * qtyC;

      if (!extraPoidsByPlu[pluC]) extraPoidsByPlu[pluC] = 0;
      extraPoidsByPlu[pluC] += poids;
    }

    // 5) on retire le CA plateau brut pour éviter double comptage
    delete ventesEANNet[eanPlateau];
  }

  return { ventesEANNet, extraPoidsByPlu, extraCaByPlu };
}


//--------------------------------------------------------
// Format
//--------------------------------------------------------
function n2(v) {
  return Number(v || 0).toFixed(2);
}

//--------------------------------------------------------
// 🔥 CHARGER INVENTAIRE
//--------------------------------------------------------
async function chargerInventaire() {

  const dateInv = dateInput.value;
  if (!dateInv) {
    alert("Choisis une date d’inventaire !");
    return;
  }

  const ventesRaw = JSON.parse(localStorage.getItem("inventaireCA") || "{}");

// 🔥 on transforme les ventes plateau -> ventes composants
const { ventesEANNet, extraPoidsByPlu } = await expandPlateauxFromCA(ventesRaw);
  tbody.innerHTML = "<tr><td colspan='9'>⏳ Chargement…</td></tr>";

  // 1. Lire tous les lots ouverts
  const snapLots = await getDocs(
    query(collection(db, "lots"), where("closed", "==", false))
  );

  let regroup = {};

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

  // 2. Lire prix vente réel
  const snapStockArticles = await getDocs(collection(db, "stock_articles"));
  const prixVente = {};
  snapStockArticles.forEach(sa => {
    const d = sa.data();
    const plu = d.PLU || sa.id.replace("PLU_", "");
    prixVente[plu] = d.pvTTCreel || 0;
  });

  // 3. Construction tableau
  const rows = [];
  dataInventaire = [];

  for (const plu of Object.keys(regroup)) {

    const stockTheo = regroup[plu].stockTheo;
    const designation = regroup[plu].designation;

    // Récup EAN
    const artSnap = await getDoc(doc(db, "articles", plu));
    const ean = artSnap.exists() ? artSnap.data().ean : null;

    const caTTC = ean && ventesEANNet[ean] ? ventesEANNet[ean] : 0;
const prixKg = prixVente[plu] || 0;

// ventes classiques
let poidsVendu = prixKg > 0 ? caTTC / prixKg : 0;

// 🔥 + ventes issues des plateaux
const extraPoids = extraPoidsByPlu[plu] || 0;
poidsVendu += extraPoids;

// optionnel : afficher un CA TTC qui inclut les plateaux
const caPlateaux = extraPoids * prixKg;
const caTTCAffiche = caTTC + caPlateaux;

const stockReel = stockTheo - poidsVendu;
const ecart = stockReel - stockTheo;


   dataInventaire.push({
  plu,
  designation,
  stockTheo,
  prixKg,
  caTTC: caTTCAffiche,
  poidsVendu,
  stockReel,
  ecart
});

    rows.push(`
      <tr data-plu="${plu}">
        <td>${plu}</td>
        <td>${designation}</td>
        <td>${n2(stockTheo)}</td>
        <td>${n2(prixKg)}</td>
        <td>${n2(caTTC)}</td>
        <td>${n2(poidsVendu)}</td>
        <td>${n2(caTTCAffiche)}</td>



        <td>
          <input class="stock-reel-input" 
                 type="number" 
                 step="0.01"
                 value="${n2(stockReel)}"
                 style="width:80px;">
        </td>

        <td class="ecart-cell">${n2(ecart)}</td>
        <td></td>
      </tr>
    `);
  }

  tbody.innerHTML = rows.join("");

  activerSaisieDirecte();
}

//--------------------------------------------------------
// ✔ SAISIE DIRECTE DANS LE TABLEAU (COMME EXCEL)
//--------------------------------------------------------
function activerSaisieDirecte() {

  document.querySelectorAll(".stock-reel-input").forEach(input => {
    input.addEventListener("input", e => {

      const tr = e.target.closest("tr");
      const plu = tr.dataset.plu;
      const nv = Number(e.target.value);

      const item = dataInventaire.find(x => x.plu === plu);
      if (!item) return;

      item.stockReel = nv;
      item.ecart = nv - item.stockTheo;

      tr.querySelector(".ecart-cell").textContent = n2(item.ecart);
    });
  });
}

//--------------------------------------------------------
// 🔥 VALIDATION INVENTAIRE
//--------------------------------------------------------
btnValider.addEventListener("click", async () => {

  const dateInv = dateInput.value;
  if (!dateInv) {
    alert("Choisis une date d’inventaire !");
    return;
  }

  if (!confirm("Valider l’inventaire ?")) return;

  valideStatus.textContent = "⏳ Application FIFO…";

  const user = auth.currentUser ? auth.currentUser.email : "inconnu";

  // 1. Appliquer FIFO aux lots
  for (const item of dataInventaire) {
    await applyInventory(item.plu, item.stockReel, user);
  }

  // 2. Mise à jour stock_articles
  valideStatus.textContent = "⏳ Mise à jour stock…";

  let totalHT = 0; // pour tableau de bord

  for (const item of dataInventaire) {

    // Lire lots restants
    const lotsSnap = await getDocs(
      query(collection(db, "lots"),
        where("closed", "==", false),
        where("plu", "==", item.plu)
      )
    );

    let totalKg = 0;
    let totalAchat = 0;

    lotsSnap.forEach(lot => {
      const d = lot.data();
      const kg = d.poidsRestant || 0;
      const prix = d.prixAchatKg || 0;

      totalKg += kg;
      totalAchat += kg * prix;
    });

    // Mise à jour stock_articles
    await setDoc(
  doc(db, "stock_articles", "PLU_" + item.plu),
  {
    poids: totalKg,
    updatedAt: serverTimestamp()
  },
  { merge: true }
);


    totalHT += totalAchat;
  }

  //--------------------------------------------------------
  // 3. ENREGISTREMENT VALEUR STOCK HT DANS /journal_inventaires
  //--------------------------------------------------------
  await setDoc(doc(db, "journal_inventaires", dateInv), {
    date: dateInv,
    valeurStockHT: totalHT,
    createdAt: serverTimestamp()
  });

  valideStatus.textContent = "✅ Inventaire validé !";
  alert("Inventaire validé.");
});

//--------------------------------------------------------
// Charger inventaire au clic
//--------------------------------------------------------
btnCharger.addEventListener("click", chargerInventaire);

// Auto reload après import CA
window.addEventListener("inventaireCAReady", chargerInventaire);
