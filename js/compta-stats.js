import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ---------------- Utils ---------------- */
const toNum = v => Number(v || 0);
const n2 = v => Number(v||0).toFixed(2);
const ymd = d => new Date(d).toISOString().slice(0,10);

/* ---------------- DOM ---------------- */
const inputFrom = document.getElementById("dateFrom");
const inputTo   = document.getElementById("dateTo");
const btnLoad   = document.getElementById("btnLoad");

const tbodyF = document.getElementById("table-fournisseurs");
const tbodyA = document.getElementById("table-articles");

const elCa  = document.getElementById("resume-ca");
const elAch = document.getElementById("resume-achats");
const elMg  = document.getElementById("resume-marge");

console.log("🔧 compta-stats.js chargé");

/* =====================================================
   1) Charger les mouvements FIFO
   ===================================================== */
async function loadMovements(from, to) {
  console.log("📥 Load mouvements FIFO...");
  const snap = await getDocs(collection(db, "stock_movements"));

  const arr = [];

  snap.forEach(d => {
    const r = d.data();
    if (r.type !== "consume") return;
   function getDateFromMovement(r) {
  if (r.date) {
    console.log("📅 mouvement avec r.date =", r.date);
    return r.date;
  }

  if (r.createdAt && r.createdAt.toDate) {
    const d = ymd(r.createdAt.toDate());
    console.log("📅 mouvement converti depuis createdAt :", d);
    return d;
  }

  console.warn("⚠ aucun champ date pour :", r);
  return null;
}

/* ----- loadMovements ----- */
async function loadMovements(from, to) {
  console.log("📥 Load mouvements FIFO...");
  const snap = await getDocs(collection(db, "stock_movements"));
  const arr = [];

  snap.forEach(d => {
    const r = d.data();
    if (r.type !== "consume") return; // on garde seulement les mouvements FIFO réels

    const movementDate = getDateFromMovement(r);
    if (!movementDate) return;

    if (movementDate >= from && movementDate <= to) {
      console.log("✔ Mouvement dans la période :", movementDate, r);
      arr.push({ id: d.id, ...r, movementDate });
    }
  });

  console.log(`📊 ${arr.length} mouvements trouvés entre ${from} → ${to}`);
  return arr;
}


/* =====================================================
   2) Lot
   ===================================================== */
async function loadLot(lotId) {
  if (!lotId) {
    console.warn("⚠ lotId vide !");
    return null;
  }

  const ref = doc(db, "lots", lotId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    console.warn("❌ Lot introuvable :", lotId);
    return null;
  }

  const lot = snap.data();
  console.log("📦 Lot chargé :", lotId, lot);
  return lot;
}

/* =====================================================
   3) Achat
   ===================================================== */
async function loadAchat(achatId) {
  if (!achatId) {
    console.warn("⚠ achatId vide !");
    return null;
  }

  const ref = doc(db, "achats", achatId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    console.warn("❌ Achat introuvable :", achatId);
    return null;
  }

  const achat = snap.data();
  console.log("🧾 Achat chargé :", achatId, achat);
  return achat;
}

/* =====================================================
   4) CA réel
   ===================================================== */
async function loadCA(from, to) {
  console.log("📥 Load CA...");
  let total = 0;

  const start = new Date(from).getTime();
  const end   = new Date(to).getTime();

  for (let ts = start; ts <= end; ts += 86400000) {
    const dateStr = ymd(ts);
    const ref = doc(db, "ventes_reelles", dateStr);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const val = toNum(snap.data().caHT);
      console.log(`💶 CA du ${dateStr} = ${val}`);
      total += val;
    }
  }

  console.log("💰 Total CA =", total);
  return total;
}

/* =====================================================
   5) Calcul principal
   ===================================================== */
async function computeStats(from, to) {
  console.log("🚀 DÉBUT CALCUL STATS");
  console.log("Période :", from, "→", to);

  const moves = await loadMovements(from, to);

  let totalAchats = 0;

  const statsF = {};
  const statsA = {};

  for (const m of moves) {
    console.log("➡ Traitement mouvement :", m);

    // 1) LOT
    const lot = await loadLot(m.lotId);
    if (!lot) {
      console.log("⛔ Pas de lot → skip");
      continue;
    }

    const plu = lot.plu || "INCONNU";
    const achatId = lot.achatId;

    // 2) ACHAT
    let fournisseurNom = "Inconnu";
    let fournisseurCode = "??";

    if (achatId) {
      const achat = await loadAchat(achatId);
      if (achat) {
        fournisseurNom = achat.fournisseurNom || "Inconnu";
        fournisseurCode = achat.fournisseurCode || "??";
      }
    }

    const montant = toNum(m.montantHT);

    console.log(`💵 Mouvement : lot=${m.lotId} plu=${plu} fournisseur=${fournisseurNom} montant=${montant}`);

    /* ---------- FOURNISSEUR ---------- */
    if (!statsF[fournisseurCode]) {
      statsF[fournisseurCode] = {
        code: fournisseurCode,
        nom: fournisseurNom,
        achat: 0,
        vente: 0,
        marge: 0,
      };
      console.log("➕ Nouveau fournisseur :", fournisseurNom);
    }

    statsF[fournisseurCode].achat += montant;
    totalAchats += montant;

    /* ---------- ARTICLE ---------- */
    if (!statsA[plu]) {
      statsA[plu] = { plu, achat: 0, vente: 0, marge: 0 };
      console.log("📘 Nouveau article :", plu);
    }

    statsA[plu].achat += montant;
  }

  console.log("📦 Stats Fournisseurs :", statsF);
  console.log("📘 Stats Articles :", statsA);

  /* ----------- CA ----------- */
  const ca = await loadCA(from, to);

  console.log("💶 CA total =", ca);
  console.log("💸 Achats consommés =", totalAchats);

  return {
    ca,
    achats: totalAchats,
    marge: ca - totalAchats,
    fournisseurs: statsF,
    articles: statsA
  };
}

/* =====================================================
   6) Rendu
   ===================================================== */
function render(stats) {
  console.log("🖥 RENDER stats :", stats);

  elCa.textContent  = n2(stats.ca) + " €";
  elAch.textContent = n2(stats.achats) + " €";
  elMg.textContent  = n2(stats.marge) + " €";

  tbodyF.innerHTML = Object.values(stats.fournisseurs)
    .map(f=>`
      <tr>
        <td>${f.nom}</td>
        <td>0 €</td>
        <td>${n2(f.achat)} €</td>
        <td>${n2(f.marge)} €</td>
        <td>${f.vente>0 ? n2(f.marge/f.vente*100) : "0"}%</td>
      </tr>
    `).join("");

  tbodyA.innerHTML = Object.values(stats.articles)
    .map(a=>`
      <tr>
        <td>${a.plu}</td>
        <td>${n2(a.vente)} €</td>
        <td>${n2(a.achat)} €</td>
        <td>${n2(a.marge)} €</td>
        <td>${a.vente>0 ? n2(a.marge/a.vente*100) : "0"}%</td>
      </tr>
    `).join("");
}

/* =====================================================
   7) MAIN
   ===================================================== */
btnLoad.addEventListener("click", async ()=>{
  console.log("👆 CLICK charger");

  const from = inputFrom.value;
  const to   = inputTo.value;

  console.log("⏱ Période demandée :", from, to);

  const stats = await computeStats(from, to);
  console.log("📊 STATS FINALES :", stats);

  render(stats);
});
