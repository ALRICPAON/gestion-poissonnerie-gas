/**************************************************
 * TRANSFORMATION – Version complète et stable
 **************************************************/
import { db } from "./firebase-init.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * UTILITAIRE : sécuriser un toFixed
 **************************************************/
function safeFixed(n, d = 2) {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toFixed(d);
}

/**************************************************
 * F9 – POPUP ARTICLES
 **************************************************/
let f9Target = null;

function openF9(target) {
  f9Target = target;
  document.getElementById("popup-f9").style.display = "flex";
  loadF9Articles();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "F9" && document.activeElement.tagName === "INPUT") {
    e.preventDefault();
    openF9(document.activeElement);
  }
});

document.getElementById("f9-close").addEventListener("click", () => {
  document.getElementById("popup-f9").style.display = "none";
});

async function loadF9Articles() {
  const snap = await getDocs(collection(db, "articles"));
  const tbody = document.querySelector("#popup-f9 tbody");
  tbody.innerHTML = "";

  snap.forEach((d) => {
    const a = d.data();

    const plu = a.PLU || a.plu || "";
    const des = a.Designation || a.designation || "";
    const latin = a.NomLatin || a.nomLatin || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${plu}</td>
      <td>${des}</td>
      <td>${latin}</td>
    `;
    tr.onclick = () => {
      f9Target.value = plu;
      document.getElementById("popup-f9").style.display = "none";
    };
    tbody.appendChild(tr);
  });
}

/**************************************************
 * CHANGEMENT TYPE FORMULAIRE
 **************************************************/
const selector = document.getElementById("type-transformation");
const formContainer = document.getElementById("form-container");

selector.addEventListener("change", renderForm);
renderForm();

/**************************************************
 * FORMULAIRE TRANSFO SIMPLE
 **************************************************/
function renderForm() {
  const type = selector.value;

  if (type === "simple") {
    formContainer.innerHTML = `
      <form id="form-simple" class="header-box">

        <h2>Transformation simple</h2>

        <label>PLU source</label>
        <input type="text" id="plu-source" placeholder="PLU source (F9)" required>

        <label>Poids consommé (kg)</label>
        <input type="number" id="poids-source" step="0.001" required>

        <label>PLU final</label>
        <input type="text" id="plu-final" placeholder="PLU final (F9)" required>

        <label>Poids final obtenu (kg)</label>
        <input type="number" id="poids-final" step="0.001" required>

        <button class="btn btn-accent" type="submit">Valider</button>
      </form>
    `;

    document.getElementById("form-simple").addEventListener("submit", handleSimpleTransformation);
  }
}

/**************************************************
 * TRAITEMENT TRANSFORMATION SIMPLE
 **************************************************/
async function handleSimpleTransformation(e) {
  e.preventDefault();

  const pluSource = document.getElementById("plu-source").value.trim();
  const poidsSource = Number(document.getElementById("poids-source").value);
  const pluFinal = document.getElementById("plu-final").value.trim();
  const poidsFinal = Number(document.getElementById("poids-final").value);

  if (!pluSource || !poidsSource || !pluFinal || !poidsFinal) {
    alert("Champs manquants");
    return;
  }

  // 1️⃣ Récupérer le lot source
  const snapLots = await getDocs(collection(db, "lots"));
  let sourceLot = null;

  snapLots.forEach((d) => {
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

  const prixSourceKg = sourceLot.prixAchatKg;
  const coutTotal = prixSourceKg * poidsSource;
  const prixFinalKg = coutTotal / poidsFinal;

  /**************************************************
   * 2️⃣ Stock mouvement (sortie)
   **************************************************/
  await addDoc(collection(db, "stock_movements"), {
    plu: pluSource,
    lotId: sourceLot.id,
    poids: poidsSource,
    sens: "sortie",
    type: "transformation",
    createdAt: serverTimestamp(),
  });

  // Mise à jour lot source
  await updateDoc(doc(db, "lots", sourceLot.id), {
    poidsRestant: sourceLot.poidsRestant - poidsSource,
  });

  /**************************************************
   * 3️⃣ Création lot final
   **************************************************/
  const finalArticle = await getDoc(doc(db, "articles", pluFinal));
  const desFinal = finalArticle.exists()
    ? finalArticle.data().Designation || finalArticle.data().designation
    : "Transformation";

  const newLotRef = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    designation: desFinal,
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinalKg,
    type: "transformation",
    origineLot: sourceLot.id,
    createdAt: serverTimestamp(),
  });

  /**************************************************
   * 4️⃣ Ajout historique transformation
   **************************************************/
  await addDoc(collection(db, "transformations"), {
    type: "simple",
    pluSource,
    poidsSource,
    pluFinal,
    poidsFinal,
    prixFinalKg,
    lotFinalId: newLotRef.id,
    designationSource: sourceLot.designation || "",
    designationFinal: desFinal,
    createdAt: serverTimestamp(),
  });

  alert("Transformation enregistrée !");
  loadHistorique();
}

/**************************************************
 * 🔎 HISTORIQUE TRANSFORMATIONS
 **************************************************/
async function loadHistorique() {
  const snap = await getDocs(collection(db, "transformations"));
  const tbody = document.getElementById("transfo-list");
  tbody.innerHTML = "";

  snap.forEach((d) => {
    const t = d.data();

    const date = t.createdAt?.toDate
      ? t.createdAt.toDate().toLocaleDateString("fr-FR")
      : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${date}</td>
      <td>${t.type}</td>
      <td>${t.pluSource} – ${t.designationSource} (${safeFixed(t.poidsSource)} kg)</td>
      <td>${t.pluFinal} – ${t.designationFinal} (${safeFixed(t.poidsFinal)} kg)</td>
      <td>${safeFixed(t.prixFinalKg)} €/kg</td>
      <td>
        <button class="btn btn-danger" data-id="${d.id}" data-action="delete">🗑️</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  document.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.onclick = () => deleteTransformation(btn.dataset.id);
  });
}

loadHistorique();

/**************************************************
 * ❌ SUPPRIMER TRANSFORMATION
 **************************************************/
async function deleteTransformation(id) {
  if (!confirm("Supprimer cette transformation ?")) return;

  await deleteDoc(doc(db, "transformations", id));
  loadHistorique();
}
