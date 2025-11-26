// ------------------------------------------------------
// COMPTA STATS — Version 100% compatible Firebase réel
// ------------------------------------------------------

import { db } from "./firebase-init.js";
import {
  collection, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const toNum = v => Number(String(v || 0).replace(",", "."));
const n2 = v => Number(v || 0).toFixed(2);


// ------------------------------------------------------
// 1) Charger journaux validés
// ------------------------------------------------------
async function loadJournaux() {
  const snap = await getDocs(collection(db, "compta_journal"));
  const jours = [];
  snap.forEach(d => {
    const r = d.data();
    if (r.validated) jours.push(r);
  });
  return jours;
}


// ------------------------------------------------------
// 2) Charger LOTS + récupérer fournisseurNom via ACHAT
// ------------------------------------------------------
async function loadLotsWithFournisseur() {

  const lotsSnap = await getDocs(collection(db, "lots"));
  const lots = [];

  for (const d of lotsSnap.docs) {
    const lot = d.data();
    let fournisseurNom = "INCONNU";

    if (lot.achatId) {
      const achatSnap = await getDoc(doc(db, "achats", lot.achatId));
      if (achatSnap.exists()) {
        const achat = achatSnap.data();
        fournisseurNom = achat.fournisseurNom || "INCONNU";
      }
    }

    lots.push({
      ...lot,
      fournisseurNom
    });
  }

  return lots;
}


// ------------------------------------------------------
// 3) Calcul Stock valeur
// ------------------------------------------------------
function stockValue(lots) {
  return lots.reduce((sum, lot) =>
    sum + (toNum(lot.poidsRestant) * toNum(lot.prixAchatKg)), 0);
}


// ------------------------------------------------------
// 4) Agrégation
// ------------------------------------------------------
async function aggregateStats() {

  const journaux = await loadJournaux();
  const lots = await loadLotsWithFournisseur();

  const statsF = {};  // fournisseurs
  const statsA = {};  // articles

  for (const j of journaux) {

    const venteJour = toNum(j.caReel || 0);

    // Groupement par fournisseur
    const groupF = {};
    lots.forEach(l => {
      const four = l.fournisseurNom || "INCONNU";
      if (!groupF[four]) groupF[four] = [];
      groupF[four].push(l);
    });

    // Groupement par article
    const groupA = {};
    lots.forEach(l => {
      const plu = l.plu || "INCONNU";
      if (!groupA[plu]) groupA[plu] = [];
      groupA[plu].push(l);
    });

    // ---------------- FOURNISSEURS ----------------
    for (const four of Object.keys(groupF)) {

      const lotsF = groupF[four];

      const debut = stockValue(lotsF);   // valeur stock début = poidsRestant AVANT mvts
      const fin = debut;                 // ici même valeur car stock_restants mis à jour

      const varStock = debut - fin;

      const achats = toNum(j.achatsPeriodeHT || 0);
      const achatsConso = achats + varStock;

      if (!statsF[four]) statsF[four] = { achat: 0, vente: 0, marge: 0 };
      statsF[four].achat += achatsConso;
      statsF[four].vente += venteJour;
      statsF[four].marge += venteJour - achatsConso;
    }


    // ---------------- ARTICLES ----------------
    for (const plu of Object.keys(groupA)) {

      const lotsP = groupA[plu];

      const debut = stockValue(lotsP);
      const fin = debut;

      const varStock = debut - fin;

      const achats = toNum(j.achatsPeriodeHT || 0);
      const achatsConso = achats + varStock;

      const vente = toNum(j.ventes_par_article?.[plu] || 0);
      const marge = vente - achatsConso;

      if (!statsA[plu]) statsA[plu] = { achat: 0, vente: 0, marge: 0 };
      statsA[plu].achat += achatsConso;
      statsA[plu].vente += vente;
      statsA[plu].marge += marge;
    }
  }

  return { statsF, statsA };
}


// ------------------------------------------------------
// 5) Render
// ------------------------------------------------------
function render(statsF, statsA) {

  // Fournisseurs
  document.getElementById("table-fournisseurs").innerHTML =
    Object.entries(statsF).map(([four, v]) => `
      <tr>
        <td>${four}</td>
        <td>${n2(v.vente)} €</td>
        <td>${n2(v.achat)} €</td>
        <td>${n2(v.marge)} €</td>
        <td>${n2(v.marge / v.vente * 100 || 0)}%</td>
      </tr>
    `).join("");

  // Articles
  document.getElementById("table-articles").innerHTML =
    Object.entries(statsA).map(([plu, v]) => `
      <tr>
        <td>${plu}</td>
        <td></td>
        <td>${n2(v.vente)} €</td>
        <td>${n2(v.achat)} €</td>
        <td>${n2(v.marge)} €</td>
        <td>${n2(v.marge / v.vente * 100 || 0)}%</td>
      </tr>
    `).join("");
}


// ------------------------------------------------------
// INIT
// ------------------------------------------------------
async function refreshStats() {
  const { statsF, statsA } = await aggregateStats();
  render(statsF, statsA);
}

window.addEventListener("load", refreshStats);

