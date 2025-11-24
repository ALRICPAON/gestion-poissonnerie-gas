import { app, db } from "./firebase-init.js";
import {
  collection, getDocs, doc, deleteDoc,
  orderBy, query, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const qs = s => document.querySelector(s);
const listEl = qs("#models-list");
const btnNew = qs("#btn-new");

let UID = null;

const auth = getAuth(app);
onAuthStateChanged(auth, async user => {
  if (!user) return;
  UID = user.uid;

  btnNew.onclick = () => {
    window.location.href = "edit-plateau.html";
  };

  await loadModels();
});

async function loadModels() {
  listEl.innerHTML = `<div class="card">Chargement…</div>`;

  const qRef = query(
    collection(db, "plateaux_models"),
    orderBy("updatedAt", "desc")
  );

  const snap = await getDocs(qRef);
  if (snap.empty) {
    listEl.innerHTML = `
      <div class="card">
        <h3>Aucun plateau</h3>
        <p>Crée ton premier modèle.</p>
      </div>
    `;
    return;
  }

  let html = "";
  snap.forEach(d => {
    const m = d.data();
    if (m.userId !== UID) return;

    const compo = (m.composition || [])
      .map(c => `${c.plu} • ${c.kg}kg ${c.mode==="per_person"?" /pers":""}`)
      .join("<br>");

    html += `
      <div class="card">
        <h3>${m.nom || "Sans nom"}</h3>
        ${m.prixVente ? `<p><strong>Prix :</strong> ${Number(m.prixVente).toFixed(2)}€</p>` : ""}
        <p style="opacity:.9">${compo || "Composition vide"}</p>

        <div style="display:flex; gap:.5rem; margin-top:.75rem;">
          <button class="btn btn-muted" data-edit="${d.id}">Modifier</button>
          <button class="btn btn-primary" data-sell="${d.id}">Vendre</button>
          <button class="btn btn-red" data-del="${d.id}">Supprimer</button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll("[data-edit]").forEach(b => {
    b.onclick = () => window.location.href = `edit-plateau.html?id=${b.dataset.edit}`;
  });
  listEl.querySelectorAll("[data-sell]").forEach(b => {
    b.onclick = () => window.location.href = `vendre-plateau.html?id=${b.dataset.sell}`;
  });
  listEl.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = () => deleteModel(b.dataset.del);
  });
}

async function deleteModel(id) {
  if (!confirm("Supprimer ce modèle de plateau ?")) return;
  await deleteDoc(doc(db, "plateaux_models", id));
  await loadModels();
}
