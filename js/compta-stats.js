/*****************************************************
 * 📊 COMPTA STATS — VERSION FINALE 26/11/2025
 * Alric — Gestion Poissonnerie
 *****************************************************/

import { db } from "./firebase-init.js";
import {
  collection, getDocs, getDoc, doc, query, where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/*****************************************************
 * Utils
 *****************************************************/
const fmt = n => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 });
const ymd = d => {
  const x = new Date(d);
  return x.getFullYear() + "-" +
    String(x.getMonth()+1).padStart(2,"0") + "-" +
    String(x.getDate()).padStart(2,"0");
};

/*****************************************************
 * 🔍 1) Charger CA réel (ventes_reelles)
 *****************************************************/
async function loadCA(from, to) {
  console.log("📥 Load CA...");

  const snap = await getDocs(collection(db, "ventes_reelles"));
  let total = 0;

  snap.forEach(d => {
    const r = d.data();
    if (!r.date) return;
    if (r.date >= from && r.date <= to) {
      console.log(`💶 CA du ${r.date} = ${r.caHT}`);
      total += Number(r.caHT || 0);
    }
  });

  console.log("💰 Total CA =", total);
  return total;
}

/*****************************************************
 * 🔍 2) Charger mouvements FIFO + Inventaire
 * IMPORTANT : chez toi, stock_movements N'A PAS de champ "date"
 * donc on convertit createdAt → YYYY-MM-DD
 *****************************************************/
function getMovementDate(r) {
  if (r.date) return r.date;

  if (r.createdAt && r.createdAt.toDate) {
    return ymd(r.createdAt.toDate());
  }

  if (typeof r.createdAt === "string") return r.createdAt;

  console.warn("⚠ Mouvement sans date :", r);
  return null;
}

async function loadMovements(from, to) {
  console.log("📥 Load mouvements FIFO...");
  const snap = await getDocs(collection(db, "stock_movements"));

  const arr = [];

  snap.forEach(d => {
    const r = d.data();

    // Garder inventaire + fifo
    if (r.type !== "consume" && r.type !== "inventory") return;

    const mDate = getMovementDate(r);
    if (!mDate) return;

    if (mDate >= from && mDate <= to) {
      console.log("✔ Mouvement dans la période :", mDate, r);
      arr.push({ id: d.id, ...r, mDate });
    }
  });

  console.log(`📊 ${arr.length} mouvements trouvés entre ${from} → ${to}`);
  return arr;
}

/*****************************************************
 * 🔍 3) Charger LOTS (prix d'achat + fournisseur)
 *****************************************************/
async function loadLots() {
  console.log("📥 Load LOTS...");
  const lotsSnap = await getDocs(collection(db, "lots"));
  const lots = {};

  lotsSnap.forEach(d => {
    const r = d.data();
    lots[r.lotId] = r; // accès direct par lotId
  });

  return lots;
}

/*****************************************************
 * 🔍 4) Charger ACHATS pour retrouver fournisseurs
 *****************************************************/
async function loadAchats() {
  console.log("📥 Load ACHATS...");
  const snap = await getDocs(collection(db, "achats"));
  const achats = {};

  snap.forEach(d => {
    const r = d.data();
    achats[r.id || d.id] = r;
  });

  return achats;
}

/*****************************************************
 * 🔍 5) Charger ARTICLES pour avoir les prix vente
 *****************************************************/
async function loadArticlesStock() {
  console.log("📥 Load ARTICLES STOCK...");
  const snap = await getDocs(collection(db, "stock_articles"));
  const articles = {};

  snap.forEach(d => {
    const r = d.data();
    articles[r.plu] = r;
  });

  return articles;
}

/*****************************************************
 * 🔍 6) Calcul global : fournisseurs + articles + marge
 *****************************************************/
async function calculateStats(from, to) {
  console.log("🚀 DÉBUT CALCUL STATS");
  console.log("Période :", from, "→", to);

  const [movements, lots, achats, stockArticles] = await Promise.all([
    loadMovements(from, to),
    loadLots(),
    loadAchats(),
    loadArticlesStock()
  ]);

  const fournisseurs = {};
  const articles = {};

  let totalAchats = 0;

  /***********************************************
   * Parcours des mouvements FIFO + inventaires
   ***********************************************/
  movements.forEach(m => {
    const lot = lots[m.lotId];
    if (!lot) return;

    const achat = achats[lot.achatId];
    const fournisseur = achat?.fournisseurNom || "INCONNU";

    const plu = m.plu || lot.plu;
    const poids = Number(m.poids || 0);
    const prixAchatKg = Number(lot.prixAchatKg || 0);
    const prixVenteKg = Number(stockArticles[plu]?.pvHTreel || 0);

    const achatHT = poids * prixAchatKg;
    const caHT = poids * prixVenteKg;

    // ---------- Fournisseurs ----------
    if (!fournisseurs[fournisseur]) {
      fournisseurs[fournisseur] = {
        fournisseur,
        achats: 0,
        ventes: 0,
        marge: 0
      };
    }

    fournisseurs[fournisseur].achats += achatHT;
    fournisseurs[fournisseur].ventes += caHT;
    fournisseurs[fournisseur].marge += caHT - achatHT;

    // ---------- Articles ----------
    if (!articles[plu]) {
      articles[plu] = {
        plu,
        designation: stockArticles[plu]?.designation || "",
        achats: 0,
        ventes: 0,
        marge: 0
      };
    }

    articles[plu].achats += achatHT;
    articles[plu].ventes += caHT;
    articles[plu].marge += caHT - achatHT;

    totalAchats += achatHT;
  });

  return { fournisseurs, articles, totalAchats };
}

/*****************************************************
 * 🔍 7) Render UI
 *****************************************************/
function renderTableFournisseurs(map) {
  const tbody = document.getElementById("table-fournisseurs");
  tbody.innerHTML = "";

  Object.values(map)
    .sort((a,b)=>b.marge - a.marge)
    .slice(0,10)
    .forEach(f => {
      const pct = f.ventes > 0 ? (f.marge / f.ventes * 100).toFixed(1) : "0";
      tbody.innerHTML += `
        <tr>
          <td>${f.fournisseur}</td>
          <td>${fmt(f.ventes)} €</td>
          <td>${fmt(f.achats)} €</td>
          <td>${fmt(f.marge)} €</td>
          <td>${pct} %</td>
        </tr>
      `;
    });
}

function renderTableArticles(map) {
  const tbody = document.getElementById("table-articles");
  tbody.innerHTML = "";

  Object.values(map)
    .sort((a,b)=>b.marge - a.marge)
    .slice(0,10)
    .forEach(a => {
      const pct = a.ventes > 0 ? (a.marge / a.ventes * 100).toFixed(1) : "0";
      tbody.innerHTML += `
        <tr>
          <td>${a.plu}</td>
          <td>${a.designation}</td>
          <td>${fmt(a.ventes)} €</td>
          <td>${fmt(a.achats)} €</td>
          <td>${fmt(a.marge)} €</td>
          <td>${pct} %</td>
        </tr>
      `;
    });
}

/*****************************************************
 * 🔍 8) Main Event — Bouton "Charger"
 *****************************************************/
document.getElementById("btnLoad").addEventListener("click", async () => {
  console.log("👆 CLICK charger");

  const from = document.getElementById("dateFrom").value;
  const to   = document.getElementById("dateTo").value;

  console.log("⏱ Période demandée :", from, to);

  const ca = await loadCA(from, to);
  const { fournisseurs, articles, totalAchats } =
    await calculateStats(from, to);

  const marge = ca - totalAchats;

  // Résumés
  document.getElementById("resume-ca").textContent    = fmt(ca) + " €";
  document.getElementById("resume-achats").textContent= fmt(totalAchats) + " €";
  document.getElementById("resume-marge").textContent = fmt(marge) + " €";

  // Tables
  renderTableFournisseurs(fournisseurs);
  renderTableArticles(articles);

  console.log("📊 STATS FINALES :", {
    ca, achats: totalAchats, marge, fournisseurs, articles
  });
});
