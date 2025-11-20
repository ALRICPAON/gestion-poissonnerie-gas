/**************************************************
 * TRANSFORMATION PRO – SIMPLE + CUISINE + PLATEAU
 **************************************************/
import { db } from "./firebase-init.js";
import {
  collection, addDoc, getDocs, getDoc,
  doc, updateDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";


/**************************************************
 * Utils
 **************************************************/
function safe(n, d = 2) {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toFixed(d);
}
function uuid() { return Math.random().toString(36).slice(2); }


/**************************************************
 * POPUP F9
 **************************************************/
let f9Target = null;
function openF9(target) {
  f9Target = target;
  document.getElementById("popup-f9").style.display = "flex";
  loadF9Articles();
}

async function loadF9Articles() {
  const tbody = document.querySelector("#popup-f9 tbody");
  const snap = await getDocs(collection(db, "articles"));
  tbody.innerHTML = "";

  snap.forEach(d => {
    const a = d.data();
    const plu = a.PLU || a.plu || "";
    const des = a.Designation || a.designation || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${plu}</td><td>${des}</td><td>${a.NomLatin || ""}</td>`;

    tr.onclick = () => {
      f9Target.value = plu;
      document.getElementById("popup-f9").style.display = "none";
    };

    tbody.appendChild(tr);
  });

  document.getElementById("f9-close").onclick = () =>
    (document.getElementById("popup-f9").style.display = "none");
}

document.addEventListener("keydown", e => {
  if (e.key === "F9" && document.activeElement.tagName === "INPUT") {
    e.preventDefault();
    openF9(document.activeElement);
  }
});


/**************************************************
 * RENDU FORMULAIRE PAR TYPE
 **************************************************/
const formContainer = document.getElementById("form-container");
const selectType = document.getElementById("type-transformation");

selectType.addEventListener("change", renderForm);
renderForm();

function renderForm() {
  const type = selectType.value;

  if (type === "simple") renderSimple();
  if (type === "cuisine") renderCuisine();
  if (type === "plateau") renderPlateau();
}


/**************************************************
 * FORMULAIRE SIMPLE
 **************************************************/
function renderSimple() {
  formContainer.innerHTML = `
    <form id="t-simple" class="header-box">
      <h2>Transformation simple</h2>

      <input id="plu-source" placeholder="PLU source (F9)">
      <input id="poids-source" type="number" step="0.001" placeholder="Poids consommé (kg)">
      <hr>
      <input id="plu-final" placeholder="PLU final (F9)">
      <input id="poids-final" type="number" step="0.001" placeholder="Poids final obtenu (kg)">
      <button class="btn btn-accent" type="submit">Enregistrer</button>
    </form>
  `;

  document.getElementById("t-simple").addEventListener("submit", handleSimple);
}


/**************************************************
 * LECTURE STOCK (LOTS)
 **************************************************/
async function getAvailableLot(plu) {
  const snap = await getDocs(collection(db, "lots"));
  let found = null;

  snap.forEach(d => {
    const L = d.data();
    if (L.plu == plu && Number(L.poidsRestant) > 0)
      found = { id: d.id, ...L };
  });

  return found;
}


/**************************************************
 * TRAITEMENT SIMPLE
 **************************************************/
async function handleSimple(e) {
  e.preventDefault();

  const pluSource = document.getElementById("plu-source").value.trim();
  const poidsSource = Number(document.getElementById("poids-source").value);
  const pluFinal = document.getElementById("plu-final").value.trim();
  const poidsFinal = Number(document.getElementById("poids-final").value);

  if (!pluSource || !poidsSource || !pluFinal || !poidsFinal) {
    return alert("Champs manquants");
  }

  const lot = await getAvailableLot(pluSource);
  if (!lot) return alert("Aucun lot disponible pour ce PLU");

  if (poidsSource > lot.poidsRestant)
    return alert("Attention : poids > stock restant");

  const prixFinalKg = (poidsSource * lot.prixAchatKg) / poidsFinal;

  /***********************
   * 1. Sortie du lot source
   ***********************/
  await addDoc(collection(db, "stock_mouvements"), {
    type: "sortie",
    mode: "transformation",
    plu: pluSource,
    lotId: lot.id,
    poids: poidsSource,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "lots", lot.id), {
    poidsRestant: lot.poidsRestant - poidsSource
  });

  /***********************
   * 2. Nouveau lot final
   ***********************/
  const newLot = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    // Chercher désignation du PLU final
const artSnap = await getDoc(doc(db, "articles", pluFinal));
const art = artSnap.exists() ? artSnap.data() : {};

designation: art.Designation || art.designation || "Transformation",
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinalKg,
    origineLot: lot.id,
    createdAt: serverTimestamp()
  });

  /***********************
   * 3. Historique
   ***********************/
  await addDoc(collection(db, "transformations"), {
    type: "simple",
    pluSource,
    poidsSource,
    pluFinal,
    poidsFinal,
    prixFinalKg,
    lotSourceId: lot.id,
    lotFinalId: newLot.id,
    createdAt: serverTimestamp()
  });

  alert("Transformation enregistrée !");
  loadHistorique();
}


/**************************************************
 * FORMULAIRE CUISINE (multi → 1)
 **************************************************/
function renderCuisine() {
  formContainer.innerHTML = `
    <form id="t-cuisine" class="header-box">
      <h2>Préparation cuisine</h2>

      <div id="ingredients"></div>

      <button type="button" class="btn btn-muted" id="add-ing">+ Ajouter ingrédient</button>

      <hr>
      <input id="plu-final" placeholder="PLU final (F9)">
      <input id="poids-final" type="number" step="0.001" placeholder="Poids total obtenu (kg)">
      <button class="btn btn-accent" type="submit">Enregistrer</button>
    </form>
  `;

  const box = document.getElementById("ingredients");
  document.getElementById("add-ing").onclick = () => {
    const id = uuid();
    box.insertAdjacentHTML("beforeend", `
      <div class="ing" data-id="${id}">
        <input placeholder="PLU ingrédient (F9)" class="plu">
        <input type="number" step="0.001" placeholder="Poids (kg)" class="poids">
      </div>
    `);
  };

  document.getElementById("t-cuisine").addEventListener("submit", handleCuisine);
}



/**************************************************
 * TRAITEMENT CUISINE
 **************************************************/
async function handleCuisine(e) {
  e.preventDefault();

  const ingredients = [...document.querySelectorAll(".ing")].map(div => ({
    plu: div.querySelector(".plu").value.trim(),
    poids: Number(div.querySelector(".poids").value)
  })).filter(i => i.plu && i.poids);

  const pluFinal = document.getElementById("plu-final").value.trim();
  const poidsFinal = Number(document.getElementById("poids-final").value);

  if (!ingredients.length) return alert("Aucun ingrédient");
  if (!pluFinal || !poidsFinal) return alert("PLU final manquant");

  let coutTotal = 0;
  const movements = [];

  for (const ing of ingredients) {
    const lot = await getAvailableLot(ing.plu);
    if (!lot) return alert("Lot manquant pour " + ing.plu);

    if (ing.poids > lot.poidsRestant)
      return alert("Poids > stock pour " + ing.plu);

    const cout = ing.poids * lot.prixAchatKg;
    coutTotal += cout;

    movements.push({ lot, poids: ing.poids });

    // sortie stock
    await addDoc(collection(db, "stock_mouvements"), {
      type: "sortie",
      mode: "cuisine",
      plu: ing.plu,
      lotId: lot.id,
      poids: ing.poids,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "lots", lot.id), {
      poidsRestant: lot.poidsRestant - ing.poids
    });
  }

  const prixFinalKg = coutTotal / poidsFinal;

  // nouveau lot
  const newLot = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinalKg,
    type: "cuisine",
    createdAt: serverTimestamp()
  });

  await addDoc(collection(db, "transformations"), {
    type: "cuisine",
    ingredients,
    pluFinal,
    poidsFinal,
    prixFinalKg,
    lotFinalId: newLot.id,
    createdAt: serverTimestamp()
  });

  alert("Préparation enregistrée !");
  loadHistorique();
}


/**************************************************
 * FORMULAIRE PLATEAU (multi → multi)
 **************************************************/
function renderPlateau() {
  formContainer.innerHTML = `
    <form id="t-plateau" class="header-box">
      <h2>Plateau – Composition</h2>
      <div id="plat-items"></div>

      <button type="button" class="btn btn-muted" id="add-plat">+ Ajouter composant</button>
      <hr>

      <button class="btn btn-accent" type="submit">Enregistrer</button>
    </form>
  `;

  const box = document.getElementById("plat-items");
  document.getElementById("add-plat").onclick = () => {
    const id = uuid();
    box.insertAdjacentHTML("beforeend", `
      <div class="ing" data-id="${id}">
        <input class="plu" placeholder="PLU (F9)">
        <input class="poids" type="number" step="0.001" placeholder="Quantité (kg)">
      </div>
    `);
  };

  document.getElementById("t-plateau").addEventListener("submit", handlePlateau);
}


/**************************************************
 * TRAITEMENT PLATEAU
 **************************************************/
async function handlePlateau(e) {
  e.preventDefault();

  const items = [...document.querySelectorAll("#plat-items .ing")].map(div => ({
    plu: div.querySelector(".plu").value.trim(),
    poids: Number(div.querySelector(".poids").value)
  })).filter(x => x.plu && x.poids);

  if (!items.length) return alert("Plateau vide.");

  let coutTotal = 0;

  for (const it of items) {
    const lot = await getAvailableLot(it.plu);
    if (!lot) return alert("Lot manquant pour " + it.plu);

    coutTotal += it.poids * lot.prixAchatKg;

    await addDoc(collection(db, "stock_mouvements"), {
      type: "sortie",
      mode: "plateau",
      lotId: lot.id,
      plu: it.plu,
      poids: it.poids,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "lots", lot.id), {
      poidsRestant: lot.poidsRestant - it.poids
    });
  }

  await addDoc(collection(db, "transformations"), {
    type: "plateau",
    items,
    coutTotal,
    createdAt: serverTimestamp()
  });

  alert("Plateau enregistré !");
  loadHistorique();
}


/**************************************************
 * HISTORIQUE
 **************************************************/
async function loadHistorique() {
  const snap = await getDocs(collection(db, "transformations"));
  const tbody = document.getElementById("transfo-list");

  tbody.innerHTML = "";

  snap.forEach(d => {
    const t = d.data();

    const date = t.createdAt?.toDate
      ? t.createdAt.toDate().toLocaleDateString("fr-FR")
      : "";

    let detail = "";

    if (t.type === "simple") {
      detail = `${t.pluSource} (${t.poidsSource} kg) → ${t.pluFinal} (${t.poidsFinal} kg)`;
    } else if (t.type === "cuisine") {
      detail = t.ingredients.map(i => `${i.plu} (${i.poids}kg)`).join(" + ") +
               ` → ${t.pluFinal} (${t.poidsFinal}kg)`;
    } else if (t.type === "plateau") {
      detail = t.items.map(i => `${i.plu} (${i.poids}kg)`).join(" + ");
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${date}</td>
      <td>${t.type}</td>
      <td>${detail}</td>
      <td>${safe(t.prixFinalKg)}</td>
      <td>
        <button class="btn btn-danger" data-id="${d.id}" data-action="delete">🗑️</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  document.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.onclick = () => deleteTransformation(btn.dataset.id);
  });
}

loadHistorique();


/**************************************************
 * SUPPRESSION (avec restauration stock)
 **************************************************/
import { increment } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function deleteTransformation(id) {
  if (!confirm("Supprimer cette transformation ?")) return;

  const snap = await getDoc(doc(db, "transformations", id));
  if (!snap.exists()) return;

  const t = snap.data();

  // 🔄 Restauration selon type
  if (t.type === "simple") {
    // Rendre au lot source
    await updateDoc(doc(db, "lots", t.lotSourceId), {
      poidsRestant: increment(Number(t.poidsSource))
    });

    // Annule le lot final (stock = 0)
    await updateDoc(doc(db, "lots", t.lotFinalId), {
      poidsRestant: 0
    });
  }

  // TODO: ajouter restauration cuisine/plateau si souhaité
  // (je te le fais après validation)

  await deleteDoc(doc(db, "transformations", id));

  loadHistorique();
  alert("Transformation supprimée.");
}

