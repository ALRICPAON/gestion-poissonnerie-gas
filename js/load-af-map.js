import { db } from "../js/firebase-init.js";
import { collection, getDocs, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const col = collection(db, "af_map");

export async function loadAFMap() {
  const tbody = document.getElementById("af-list");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Chargement…</td></tr>`;

  const snap = await getDocs(col);

  const rows = [];
  snap.forEach(d => {
    const r = d.data();
    rows.push(`
      <tr>
        <td>${r.fournisseurCode || ""}</td>
        <td>${r.fournisseurNom  || ""}</td>
        <td>${r.refFournisseur  || ""}</td>
        <td>${r.plu             || ""}</td>
        <td>${r.designationInterne || ""}</td>
        <td>
          <button class="btn" data-action="edit" data-id="${d.id}">✏️</button>
          <button class="btn btn-danger" data-action="del" data-id="${d.id}">🗑️</button>
        </td>
      </tr>
    `);
  });

  tbody.innerHTML = rows.join("") || `<tr><td colspan="6">Aucune association</td></tr>`;

  // delegation des actions
  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'edit') {
      // exposé par edit-af-map.js
      if (window.editAFMap) window.editAFMap(id);
      return;
    }
    if (action === 'del') {
      if (!confirm("Supprimer cette association ?")) return;
      await deleteDoc(doc(db, "af_map", id));
      loadAFMap();
      return;
    }
  }, { once: true }); // on re-attachera après chaque reload
}

window.addEventListener('DOMContentLoaded', loadAFMap);
