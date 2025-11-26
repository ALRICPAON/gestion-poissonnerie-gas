import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ------------------------------------------------------------------
   🧰 UTILS
-------------------------------------------------------------------*/
const fmt = n => Number(n || 0).toFixed(2) + " €";
const d2 = d => d.toISOString().split("T")[0];

/* ------------------------------------------------------------------
   🔥 1) LOAD CA RÉEL (compta_journal)
-------------------------------------------------------------------*/
async function loadCA(from, to) {
  const col = collection(db, "compta_journal");
  const qy = query(col,
    where("date", ">=", from),
    where("date", "<=", to)
  );

  const snap = await getDocs(qy);
  let totalCA = 0;

  snap.forEach(d => {
    totalCA += Number(d.data().caReel || 0);
  });

  console.log("💰 Total CA =", totalCA);
  return totalCA;
}

/* ------------------------------------------------------------------
   🔥 2) LOAD MOUVEMENTS FIFO (sorties = consommations)
-------------------------------------------------------------------*/
async function loadMouvements(from, to) {
  console.log("📥 Load MOVEMENTS from stock_movements…");

  const snap = await getDocs(collection(db, "stock_movements"));

  const list = [];
  const fromD = new Date(from + "T00:00:00");
  const toD = new Date(to + "T23:59:59");

  snap.forEach(doc => {
    const d = doc.data();

    // garder uniquement les vraies ventes FIFO
    if (d.sens !== "sortie") return;
    if (d.type === "inventory") return;
    if (d.type === "transformation") return;
    if (d.type === "correction") return;
    if (d.poids <= 0) return;

    let dt = null;
    if (d.createdAt?.toDate) dt = d.createdAt.toDate();
    else if (d.createdAt instanceof Date) dt = d.createdAt;
    else return;

    if (dt >= fromD && dt <= toD) {
      console.log("✔ Vente réelle :", d);
      list.push(d);
    }
  });

  console.log(`📦 ${list.length} mouvements trouvés`);
  return list;
}


/* ------------------------------------------------------------------
   🔥 3) LOAD LOTS
-------------------------------------------------------------------*/
async function loadLots() {
  const col = collection(db, "lots");
  const snap = await getDocs(col);

  const lots = {};
  snap.forEach(doc => {
    lots[doc.id] = doc.data();
  });

  console.log("📥 LOTS chargés :", lots);
  return lots;
}

/* ------------------------------------------------------------------
   🔥 4) LOAD ACHATS (pour récupérer fournisseur)
-------------------------------------------------------------------*/
async function loadAchats() {
  const col = collection(db, "achats");
  const snap = await getDocs(col);

  const achats = {};
  snap.forEach(doc => {
    achats[doc.id] = doc.data();
  });

  console.log("📥 ACHATS chargés :", achats);
  return achats;
}

/* ------------------------------------------------------------------
   🔥 5) CALCUL STATISTIQUES
-------------------------------------------------------------------*/
async function calculStats(from, to) {
  console.log("🚀 DÉBUT CALCUL STATS");

  const [ca, mouvements, lots, achats] = await Promise.all([
    loadCA(from, to),
    loadMouvements(from, to),
    loadLots(),
    loadAchats()
  ]);

  let achatsConso = 0;

  const statsFournisseurs = {};  // {fournisseurNom: {ca, achats, marge}}
  const statsArticles = {};      // {plu: {designation, ca, achats, marge}}

  for (const m of mouvements) {

    const lot = lots[m.lotId];
    if (!lot) continue;

    const achat = achats[lot.achatId] || {};
    const fournisseur = achat.fournisseurNom || "INCONNU";

    const plu = lot.plu;
    const designation = lot.designation;

    const prixKg = Number(lot.prixAchatKg || 0);
    const po = Number(m.poids || 0);
    const achatHT = po * prixKg;

    achatsConso += achatHT;

    // FOURNISSEUR
    if (!statsFournisseurs[fournisseur]) {
      statsFournisseurs[fournisseur] = { ca: 0, achats: 0, marge: 0 };
    }
    statsFournisseurs[fournisseur].achats += achatHT;

    // ARTICLE
    if (!statsArticles[plu]) {
      statsArticles[plu] = {
        designation: designation,
        ca: 0,
        achats: 0,
        marge: 0
      };
    }
    statsArticles[plu].achats += achatHT;
  }

  // AJOUT DU CA
  for (const f in statsFournisseurs) {
    statsFournisseurs[f].ca = ca;
    statsFournisseurs[f].marge = ca - statsFournisseurs[f].achats;
  }

  for (const p in statsArticles) {
    const art = statsArticles[p];
    art.ca = ca;
    art.marge = ca - art.achats;
    art.margePct = art.ca > 0 ? (art.marge / art.ca * 100) : 0;
  }

  const margeTotale = ca - achatsConso;

  const final = {
    ca,
    achats: achatsConso,
    marge: margeTotale,
    fournisseurs: statsFournisseurs,
    articles: statsArticles
  };

  console.log("📊 STATS FINALES :", final);
  return final;
}

/* ------------------------------------------------------------------
   🔥 6) RENDU HTML
-------------------------------------------------------------------*/
function renderStats(stats) {
  document.querySelector("#resume-ca").textContent = fmt(stats.ca);
  document.querySelector("#resume-achats").textContent = fmt(stats.achats);
  document.querySelector("#resume-marge").textContent = fmt(stats.marge);

  // FOURNISSEURS
  const tf = document.querySelector("#table-fournisseurs");
  tf.innerHTML = "";

  for (const f in stats.fournisseurs) {
    const s = stats.fournisseurs[f];
    const pct = s.ca > 0 ? ((s.marge / s.ca) * 100).toFixed(1) : 0;

    tf.innerHTML += `
      <tr>
        <td>${f}</td>
        <td>${fmt(s.ca)}</td>
        <td>${fmt(s.achats)}</td>
        <td>${fmt(s.marge)}</td>
        <td>${pct}%</td>
      </tr>`;
  }

  // ARTICLES
  const ta = document.querySelector("#table-articles");
  ta.innerHTML = "";

  for (const plu in stats.articles) {
    const a = stats.articles[plu];

    ta.innerHTML += `
      <tr>
        <td>${plu}</td>
        <td>${a.designation}</td>
        <td>${fmt(a.ca)}</td>
        <td>${fmt(a.achats)}</td>
        <td>${fmt(a.marge)}</td>
        <td>${a.margePct.toFixed(1)}%</td>
      </tr>`;
  }
}

/* ------------------------------------------------------------------
   🔥 7) BOUTONS / CHARGEMENT
-------------------------------------------------------------------*/
document.querySelector("#btnLoad").addEventListener("click", async () => {
  const from = document.querySelector("#dateFrom").value;
  const to = document.querySelector("#dateTo").value;

  console.log("⏱ Période demandée :", from, to);

  const stats = await calculStats(from, to);
  renderStats(stats);
});

/* Raccourcis (jour, semaine, mois, année) */
document.querySelectorAll("[data-period]").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.period;
    const now = new Date();

    let from, to;

    if (p === "day") {
      from = to = d2(now);
    }

    if (p === "week") {
      const d = new Date();
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      from = d2(d);
      to = d2(new Date());
    }

    if (p === "month") {
      from = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-01";
      to = d2(now);
    }

    if (p === "year") {
      from = now.getFullYear() + "-01-01";
      to = d2(now);
    }
    function renderChartFournisseurs(fournisseurs) {
  const ctx = document.getElementById('chartFournisseurs').getContext('2d');
  const labels = Object.keys(fournisseurs);
  const data = Object.values(fournisseurs).map(f => f.marge);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: "Marge (€)",
        data
      }]
    }
  });
}

function renderChartArticles(articles) {
  const ctx = document.getElementById('chartArticles').getContext('2d');
  const labels = Object.keys(articles);
  const data = Object.values(articles).map(a => a.marge);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: "Marge (€)",
        data
      }]
    }
  });
}
    function renderTableFournisseurs(fournisseurs) {
  const tbody = document.getElementById("table-fournisseurs");

  tbody.innerHTML = Object.entries(fournisseurs)
    .map(([name, f]) => {
      const pct = f.vente > 0 ? (f.marge / f.vente * 100) : 0;
      return `
        <tr>
          <td>${name}</td>
          <td>${f.vente.toFixed(2)} €</td>
          <td>${f.achat.toFixed(2)} €</td>
          <td>${f.marge.toFixed(2)} €</td>
          <td>${pct.toFixed(1)}%</td>
        </tr>
      `;
    })
    .join("");
}

function renderTableArticles(articles) {
  const tbody = document.getElementById("table-articles");

  tbody.innerHTML = Object.entries(articles)
    .map(([plu, a]) => {
      const pct = a.vente > 0 ? (a.marge / a.vente * 100) : 0;
      return `
        <tr>
          <td>${plu}</td>
          <td>${a.designation || ""}</td>
          <td>${a.vente.toFixed(2)} €</td>
          <td>${a.achat.toFixed(2)} €</td>
          <td>${a.marge.toFixed(2)} €</td>
          <td>${pct.toFixed(1)}%</td>
        </tr>
      `;
    })
    .join("");
}

renderTableFournisseurs(stats.fournisseurs);
renderTableArticles(stats.articles);

renderChartFournisseurs(stats.fournisseurs);
renderChartArticles(stats.articles);


    document.querySelector("#dateFrom").value = from;
    document.querySelector("#dateTo").value = to;

    document.querySelector("#btnLoad").click();
  });
});
