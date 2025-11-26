import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, where
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

/* =====================================================
   1) Charger TOUS les mouvements FIFO dans la période
   ===================================================== */
async function loadMovements(from, to) {
  const snap = await getDocs(collection(db, "stock_movements"));
  const arr = [];

  snap.forEach(d => {
    const r = d.data();
    if (r.type !== "consume") return;
    if (!r.date) return;

    if (r.date >= from && r.date <= to) {
      arr.push({ id: d.id, ...r });
    }
  });

  return arr;
}

/* =====================================================
   2) Charger un lot
   ===================================================== */
async function loadLot(lotId) {
  const ref = doc(db, "lots", lotId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/* =====================================================
   3) Charger un achat
   ===================================================== */
async function loadAchat(achatId) {
  const snap = await getDoc(doc(db, "achats", achatId));
  return snap.exists() ? snap.data() : null;
}

/* =====================================================
   4) Charger CA réel (ventes_reelles)
   ===================================================== */
async function loadCA(from, to) {
  let total = 0;

  for (let ts = new Date(from).getTime(); ts <= new Date(to).getTime(); ts += 86400000) {
    const dateStr = ymd(ts);
    const snap = await getDoc(doc(db, "ventes_reelles", dateStr));
    if (snap.exists()) {
      total += toNum(snap.data().caHT);
    }
  }

  return total;
}

/* =====================================================
   5) Calcul principal
   ===================================================== */
async function computeStats(from, to) {
  const moves = await loadMovements(from, to);

  let totalAchats = 0;

  const statsF = {};  // par fournisseur
  const statsA = {};  // par article (PLU)

  for (const m of moves) {

    // 1) le lot d'origine
    const lot = await loadLot(m.lotId);
    if (!lot) continue;

    const plu = lot.plu || "INCONNU";
    const achatId = lot.achatId;

    // 2) fournisseur de l'achat
    let fournisseurNom = "INCONNU";
    let fournisseurCode = "??";

    if (achatId) {
      const achat = await loadAchat(achatId);
      if (achat) {
        fournisseurNom = achat.fournisseurNom || "INCONNU";
        fournisseurCode = achat.fournisseurCode || "??";
      }
    }

    const montant = toNum(m.montantHT);

    /* ---------- Stats fournisseur ---------- */
    if (!statsF[fournisseurCode]) {
      statsF[fournisseurCode] = {
        code: fournisseurCode,
        nom: fournisseurNom,
        achat: 0,
        vente: 0,
        marge: 0,
      };
    }
    statsF[fournisseurCode].achat += montant;
    totalAchats += montant;

    /* ---------- Stats article ---------- */
    if (!statsA[plu]) {
      statsA[plu] = {
        plu,
        achat: 0,
        vente: 0,
        marge: 0
      };
    }
    statsA[plu].achat += montant;
  }

  /* ----------- CA réel ----------- */
  const ca = await loadCA(from, to);

  /* ----------- marges ----------- */
  for (const f of Object.values(statsF)) {
    const percent = f.vente > 0 ? (f.marge / f.vente * 100) : 0;
    f.pct = percent;
  }
  for (const a of Object.values(statsA)) {
    a.marge = a.vente - a.achat;
  }

  return {
    ca,
    achats: totalAchats,
    marge: ca - totalAchats,
    fournisseurs: statsF,
    articles: statsA
  };
}

/* =====================================================
   6) AFFICHAGE
   ===================================================== */
function render(stats) {
  elCa.textContent  = n2(stats.ca) + " €";
  elAch.textContent = n2(stats.achats) + " €";
  elMg.textContent  = n2(stats.marge) + " €";

  tbodyF.innerHTML = Object.values(stats.fournisseurs)
    .sort((a,b)=>b.achat - a.achat)
    .map(f=>`
      <tr>
        <td>${f.nom}</td>
        <td>0 €</td>
        <td>${n2(f.achat)} €</td>
        <td>${n2(f.marge)} €</td>
        <td>${n2(f.pct)}%</td>
      </tr>
    `).join("");

  tbodyA.innerHTML = Object.values(stats.articles)
    .sort((a,b)=>b.achat - a.achat)
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
  const from = inputFrom.value;
  const to   = inputTo.value;

  const stats = await computeStats(from, to);
  render(stats);
});
