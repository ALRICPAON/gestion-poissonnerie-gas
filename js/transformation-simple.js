// ----------------------------------------------
// IMPORTS
// ----------------------------------------------
import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";


// ----------------------------------------------
// POPUP F9
// ----------------------------------------------

const popupF9 = document.getElementById("popup-f9");
const f9Search = document.getElementById("f9-search");
const f9TableBody = document.querySelector("#f9-table tbody");
const f9Close = document.getElementById("f9-close");

let f9CurrentInput = null;
let articlesCache = [];

// Charger ARTICLES une seule fois
async function loadArticlesOnce() {
  if (articlesCache.length > 0) return;

  const snap = await getDocs(collection(db, "articles"));
  snap.forEach(docu => {
    const a = docu.data();
    articlesCache.push({
      plu: a.PLU || a.plu || docu.id,
      designation: a.Designation || a.designation || ""
    });
  });
}

// Ouvre popup sur input ciblé
async function openF9Popup(inputEl) {
  f9CurrentInput = inputEl;

  await loadArticlesOnce();
  renderF9List("");

  popupF9.style.display = "block";
  f9Search.value = "";
  f9Search.focus();
}

// Fermer popup
function closeF9Popup() {
  popupF9.style.display = "none";
  f9CurrentInput = null;
}

// Affiche la liste filtrée
function renderF9List(filter) {
  const q = filter.toLowerCase().trim();

  const rows = articlesCache.filter(a =>
    `${a.plu} ${a.designation}`.toLowerCase().includes(q)
  );

  if (rows.length === 0) {
    f9TableBody.innerHTML = `<tr><td colspan="2">Aucun résultat</td></tr>`;
    return;
  }

  f9TableBody.innerHTML = rows.map(a => `
    <tr data-plu="${a.plu}" data-des="${a.designation}">
      <td>${a.plu}</td>
      <td>${a.designation}</td>
    </tr>
  `).join("");

  // double-clic pour choisir
  f9TableBody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("dblclick", () => {
      const plu = tr.dataset.plu;
      const des = tr.dataset.des;

      if (f9CurrentInput) {
        f9CurrentInput.value = plu;
        f9CurrentInput.dispatchEvent(new Event("change"));
      }

      closeF9Popup();
    });
  });
}

f9Search.addEventListener("input", () => renderF9List(f9Search.value));
f9Close.addEventListener("click", closeF9Popup);


// ----------------------------------------------
// GESTION DES F9 SUR LES CHAMPS
// ----------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.key === "F9") {
    e.preventDefault();
    const active = document.activeElement;

    if (active && (active.id === "plu-source" || active.id === "plu-final")) {
      openF9Popup(active);
    }
  }
});


// -------------------------------------------------
// AUTO-AFFICHAGE INFOS PRODUIT
// -------------------------------------------------

async function loadArticleInfo(plu, box) {
  if (!plu) {
    box.innerHTML = "";
    return;
  }

  const snap = await getDoc(doc(db, "articles", plu));
  if (!snap.exists()) {
    box.innerHTML = `<div class="pill pill-red">PLU introuvable</div>`;
    return;
  }

  const a = snap.data();

  box.innerHTML = `
    <div class="pill">${a.Designation || a.designation || ""}</div>
    <div class="pill">${a.NomLatin || a.nomLatin || ""}</div>
    <div class="pill">${a.Zone || a.zone || ""} ${a.SousZone || a.sousZone || ""}</div>
    <div class="pill">${a.Engin || a.engin || ""}</div>
  `;
}


// ----------------------------------------------
// CALCUL TRANSFORMATION SIMPLE
// ----------------------------------------------

document.getElementById("plu-source").addEventListener("change", async (e) => {
  await loadArticleInfo(e.target.value.trim(), document.getElementById("src-info"));
});

document.getElementById("plu-final").addEventListener("change", async (e) => {
  await loadArticleInfo(e.target.value.trim(), document.getElementById("final-info"));
});


document.getElementById("form-trans-simple").addEventListener("submit", async (e) => {
  e.preventDefault();

  const pluSource = document.getElementById("plu-source").value.trim();
  const poidsSource = parseFloat(document.getElementById("poids-source").value);

  const pluFinal = document.getElementById("plu-final").value.trim();
  const poidsFinal = parseFloat(document.getElementById("poids-final").value);

  if (!pluSource || !pluFinal || !poidsSource || !poidsFinal) {
    alert("Complète tous les champs.");
    return;
  }

  // Récupération du prix moyen du stock pour calculer le nouveau CUMP
  const snap = await getDoc(doc(db, "stock_articles", pluSource));
  const stock = snap.exists() ? snap.data() : null;

  const prixSource = stock?.prixKg || 0;
  const coutTotal = prixSource * poidsSource;

  const newPrixFinal = +(coutTotal / poidsFinal).toFixed(2);

  // On enregistre la transformation dans Firestore
  await addDoc(collection(db, "transformations"), {
    type: "simple",
    pluSource,
    poidsSource,
    pluFinal,
    poidsFinal,
    prixFinal: newPrixFinal,
    createdAt: serverTimestamp()
  });

  alert(`Transformation enregistrée.\nNouveau prix moyen : ${newPrixFinal} €/kg`);

  location.reload();
});
