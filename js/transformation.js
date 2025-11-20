/**************************************************
 * TRANSFORMATION – Version complète et fonctionnelle
 **************************************************/
import { db } from "./firebase-init.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  serverTimestamp, getDoc, increment
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * 🟦 UTIL - Sécurisation number.toFixed
 **************************************************/
const safeFixed = (n, d = 2) =>
  n == null || isNaN(Number(n)) ? "—" : Number(n).toFixed(d);

/**************************************************
 * 🟦 F9 – Popup articles
 **************************************************/
let f9Target = null;

function openF9(input) {
  f9Target = input;
  document.getElementById("popup-f9").style.display = "flex";
  loadF9Articles();
}

async function loadF9Articles() {
  const tbody = document.querySelector("#popup-f9 tbody");
  tbody.innerHTML = "";

  const snap = await getDocs(collection(db, "articles"));

  snap.forEach(d => {
    const a = d.data();
    const plu = a.PLU || a.plu || "";
    const des = a.Designation || a.designation || "";
    const latin = a.NomLatin || "";

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
 * 🟦 FORMULAIRE TRANSFORMATION SIMPLE
 **************************************************/
const formSimple = document.getElementById("form-trans-simple");
formSimple?.addEventListener("submit", handleSimpleTransformation);

async function handleSimpleTransformation(e) {
  e.preventDefault();

  const pluSource = document.getElementById("plu-source").value.trim();
  const poidsSource = Number(document.getElementById("poids-source").value);
  const pluFinal = document.getElementById("plu-final").value.trim();
  const poidsFinal = Number(document.getElementById("poids-final").value);

  if (!pluSource || !poidsSource || !pluFinal || !poidsFinal) {
    return alert("Champs manquants.");
  }

  /**************************************************
   * 1️⃣ Chercher le lot disponible pour le PLU source
   **************************************************/
  const snapLots = await getDocs(collection(db, "lots"));
  let sourceLot = null;

  snapLots.forEach(d => {
    const l = d.data();
    if (l.plu == pluSource && (l.poidsRestant || 0) > 0) {
      sourceLot = { id: d.id, ...l };
    }
  });

  if (!sourceLot) return alert("Aucun lot disponible pour ce PLU.");
  if (poidsSource > sourceLot.poidsRestant)
    return alert("Poids consommé supérieur au restant !");

  /**************************************************
   * 2️⃣ Récupérer la désignation du PLU final
   **************************************************/
  const artSnap = await getDoc(doc(db, "articles", pluFinal));
  const art = artSnap.exists() ? artSnap.data() : {};
  const desFinal = art.Designation || art.designation || "Produit transformé";

  /**************************************************
   * 3️⃣ Calcul des coûts
   **************************************************/
  const prixSourceKg = Number(sourceLot.prixAchatKg);
  const coutTotal = prixSourceKg * poidsSource;
  const prixFinalKg = coutTotal / poidsFinal;

  /**************************************************
   * 4️⃣ Mouvement sortie (pour TRAÇABILITÉ)
   **************************************************/
  await addDoc(collection(db, "stock_mouvements"), {
    lotId: sourceLot.id,
    plu: pluSource,
    poids: poidsSource,
    sens: "sortie",
    type: "TRANSFORMATION",
    createdAt: serverTimestamp()
  });

  // MAJ lot source
  await updateDoc(doc(db, "lots", sourceLot.id), {
    poidsRestant: sourceLot.poidsRestant - poidsSource
  });

  /**************************************************
   * 5️⃣ Nouveau lot créé (entrée)
   **************************************************/
  const newLotRef = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    designation: desFinal,
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinalKg,
    type: "transformation",
    origineLot: sourceLot.id,
    createdAt: serverTimestamp()
  });

  /**************************************************
   * 6️⃣ Mouvement entrée (pour TRAÇABILITÉ)
   **************************************************/
  await addDoc(collection(db, "stock_mouvements"), {
    lotId: newLotRef.id,
    plu: pluFinal,
    poids: poidsFinal,
    sens: "entrée",
    type: "TRANSFORMATION",
    createdAt: serverTimestamp()
  });

  /**************************************************
   * 7️⃣ Historique transformation
   **************************************************/
  await addDoc(collection(db, "transformations"), {
    type: "simple",
    pluSource,
    poidsSource,
    pluFinal,
    poidsFinal,
    prixFinalKg,
    lotSourceId: sourceLot.id,
    lotFinalId: newLotRef.id,
    createdAt: serverTimestamp()
  });

  alert("Transformation enregistrée !");
  loadHistorique();
}

/**************************************************
 * 🟦 Chargement historique
 **************************************************/
async function getDesignation(plu) {
  const snap = await getDoc(doc(db, "articles", plu));
  if (!snap.exists()) return "";
  const a = snap.data();
  return a.Designation || a.designation || "";
}

async function loadHistorique() {
  const tbody = document.getElementById("transfo-list");
  if (!tbody) return;

  tbody.innerHTML = "";

  const snap = await getDocs(collection(db, "transformations"));

  for (const d of snap.docs) {
    const t = d.data();

    const desSource = await getDesignation(t.pluSource);
    const desFinal = await getDesignation(t.pluFinal);

    const date = t.createdAt?.toDate
      ? t.createdAt.toDate().toLocaleDateString("fr-FR")
      : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${date}</td>
      <td>${t.type}</td>
      <td>${t.pluSource} – ${desSource} (${safeFixed(t.poidsSource)} kg)</td>
      <td>${t.pluFinal} – ${desFinal} (${safeFixed(t.poidsFinal)} kg)</td>
      <td>${safeFixed(t.prixFinalKg)} €/kg</td>
      <td>
        <button class="btn btn-danger" data-id="${d.id}" data-action="delete">🗑️</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  document.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.addEventListener("click", () => deleteTransformation(btn.dataset.id));
  });
}

loadHistorique();

/**************************************************
 * 🟦 Suppression transformation + restauration stock
 **************************************************/
async function deleteTransformation(id) {
  if (!confirm("Supprimer cette transformation ?")) return;

  const snap = await getDoc(doc(db, "transformations", id));
  if (!snap.exists()) return;

  const t = snap.data();

  // Restaure le lot source
  if (t.lotSourceId) {
    await updateDoc(doc(db, "lots", t.lotSourceId), {
      poidsRestant: increment(Number(t.poidsSource))
    });
  }

  // Vide le lot final
  if (t.lotFinalId) {
    await updateDoc(doc(db, "lots", t.lotFinalId), {
      poidsRestant: 0
    });
  }

  await deleteDoc(doc(db, "transformations", id));

  alert("Transformation supprimée.");
  loadHistorique();
}
