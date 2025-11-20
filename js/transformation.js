/**************************************************
 * TRANSFORMATION – Version complète
 **************************************************/
import { db } from "./firebase-init.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --- Sécurise l'affichage des nombres (évite crash .toFixed sur undefined) ---
function safeFixed(n, decimals = 2) {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toFixed(decimals);
}



/**************************************************
 * 🔵 F9 → Liste articles
 **************************************************/
let f9Target = null;

function openF9(targetInput) {
  f9Target = targetInput;
  document.getElementById("popup-f9").style.display = "flex";
  loadF9Articles();
}

async function loadF9Articles() {
  const snap = await getDocs(collection(db, "articles"));
  const tbody = document.querySelector("#popup-f9 tbody");
  tbody.innerHTML = "";

  snap.forEach(d => {
  const a = d.data();

  // Sécurisation : toujours lower-case pour éviter undefined
  const plu = a.PLU || a.plu || "";
  const des = a.Designation || a.designation || "";
  const nomLatin = a.NomLatin || a.nomLatin || "";

  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td>${plu}</td>
    <td>${des}</td>
    <td>${nomLatin}</td>
  `;

  tr.onclick = () => {
    f9Target.value = plu;
    document.getElementById("popup-f9").style.display = "none";
  };

  tbody.appendChild(tr);
});


document.addEventListener("keydown", e => {
  if (e.key === "F9" && document.activeElement.tagName === "INPUT") {
    e.preventDefault();
    openF9(document.activeElement);
  }
});

document.getElementById("f9-close")?.addEventListener("click", () => {
  document.getElementById("popup-f9").style.display = "none";
});


/**************************************************
 * 🔷 Chargement dynamique du formulaire
 **************************************************/
const formContainer = document.getElementById("form-container");
const selector = document.getElementById("type-transformation");

selector.addEventListener("change", renderForm);
renderForm();


function renderForm() {
  const type = selector.value;

  if (type === "simple") renderSimple();
  if (type === "cuisine") renderCuisine();
  if (type === "plateau") renderPlateau();
}


/**************************************************
 * 🟦 FORMULAIRE – Transformation simple
 **************************************************/
function renderSimple() {
  formContainer.innerHTML = `
    <form id="form-simple" class="header-box">
      <h2>Transformation simple</h2>

      <input type="text" id="plu-source" placeholder="PLU source (F9)" required>
      <input type="number" id="poids-source" step="0.001" placeholder="Poids consommé (kg)" required>

      <input type="text" id="plu-final" placeholder="PLU final (F9)" required>
      <input type="number" id="poids-final" step="0.001" placeholder="Poids final obtenu (kg)" required>

      <button class="btn btn-accent" type="submit">Valider</button>
    </form>
  `;

  document.getElementById("form-simple").addEventListener("submit", handleSimpleTransformation);
}


/**************************************************
 * 🟦 Traitement de la transformation simple
 **************************************************/
async function handleSimpleTransformation(e) {
  e.preventDefault();

  const pluSource = document.getElementById("plu-source").value.trim();
  const poidsSource = Number(document.getElementById("poids-source").value);
  const pluFinal = document.getElementById("plu-final").value.trim();
  const poidsFinal = Number(document.getElementById("poids-final").value);

  if (!pluSource || !poidsSource || !pluFinal || !poidsFinal) {
    alert("Champs manquants.");
    return;
  }

  // 1️⃣ Chercher le lot en stock
  const snapLots = await getDocs(collection(db, "lots"));
  let sourceLot = null;

  snapLots.forEach(d => {
    const l = d.data();
    if (l.plu == pluSource && (l.poidsRestant || 0) > 0) {
      sourceLot = { id: d.id, ...l };
    }
  });

  if (!sourceLot) {
    alert("Aucun lot disponible pour ce PLU.");
    return;
  }

  if (poidsSource > sourceLot.poidsRestant) {
    alert("Poids consommé supérieur au restant !");
    return;
  }

  // Calcul du coût final
  const prixSourceKg = sourceLot.prixAchatKg;
  const coûtTotal = poidsSource * prixSourceKg;
  const prixFinalKg = coûtTotal / poidsFinal;

  // 2️⃣ Écriture mouvement sortie
  await addDoc(collection(db, "stock_mouvements"), {
    plu: pluSource,
    lotId: sourceLot.id,
    poids: poidsSource,
    sens: "sortie",
    type: "transformation",
    createdAt: serverTimestamp()
  });

  // MAJ lot source
  await updateDoc(doc(db, "lots", sourceLot.id), {
    poidsRestant: sourceLot.poidsRestant - poidsSource
  });

  // 3️⃣ Création nouveau lot final
  const newLotRef = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    designation: "Produit transformé",
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinalKg,
    type: "transformation",
    origineLot: `Transformation depuis ${sourceLot.plu}`,
    createdAt: serverTimestamp()
  });

  // 4️⃣ Historique
  await addDoc(collection(db, "transformations"), {
    type: "simple",
    pluSource,
    poidsSource,
    prixSourceKg,
    pluFinal,
    poidsFinal,
    prixFinalKg,
    lotFinalId: newLotRef.id,
    createdAt: serverTimestamp()
  });

  alert("Transformation enregistrée !");
  loadHistorique();
}



/**************************************************
 * 📜 HISTORIQUE
 **************************************************/
async function loadHistorique() {
  const snap = await getDocs(collection(db, "transformations"));
  const tbody = document.getElementById("transfo-list");

  tbody.innerHTML = "";

  snap.forEach(d => {
    const t = d.data();
    const tr = document.createElement("tr");

    const date = t.createdAt?.toDate
      ? t.createdAt.toDate().toLocaleDateString("fr-FR")
      : "";

    tr.innerHTML = `
      <td>${date}</td>
      <td>${t.type}</td>
      <td>${t.pluSource} → ${t.poidsSource} kg</td>
      <td>${t.pluFinal} → ${t.poidsFinal} kg</td>
      <td>${safeFixed(t.prixFinalKg, 2)} €/kg</td>
      <td>
        <button class="btn btn-muted" data-id="${d.id}" data-action="edit">✏️</button>
        <button class="btn btn-danger" data-id="${d.id}" data-action="delete">🗑️</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  document.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.addEventListener("click", () => deleteTransformation(btn.dataset.id));
  });
}

loadHistorique();


/**************************************************
 * ❌ Suppression transformation
 **************************************************/
async function deleteTransformation(id) {
  if (!confirm("Supprimer cette transformation ?")) return;
  await deleteDoc(doc(db, "transformations", id));
  loadHistorique();
}
