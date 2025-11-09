import { db } from "../js/firebase-init.js";
import { collection, getDocs, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const col = collection(db, "af_map");

export async function loadAFMap() {
  const tbody = document.getElementById("af-list");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Chargement…</td></tr>`;

  const snap = await getDocs(col);

  let html = "";

  snap.forEach(d => {
    const r = d.data();

    html += `
      <tr>
        <td>${r.fournisseurCode ? r.fournisseurCode : ""}</td>
        <td>${r.fournisseurNom  ? r.fournisseurNom  : ""}</td>
        <td>${r.refFournisseur  ? r.refFournisseur  : ""}</td>
        <td>${r.plu             ? r.plu             : ""}</td>
        <td>${r.designationInterne ? r.designationInterne : ""}</td>
        <td>
          <button class="btn" data-action="edit" data-id="${d.id}">✏️</button>
          <button class="btn btn-danger" data-action="del" data-id="${d.id}">🗑️</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html || `<tr><td colspan="6">Aucune association</td></tr>`;

  // délégation
  tbody.addEventListener(
    "click",
    async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");

      if (action === "edit") {
        if (window.editAFMap) window.editAFMap(id);
        return;
      }

      if (action === "del") {
        if (!confirm("Supprimer ?")) return;
        await deleteDoc(doc(db, "af_map", id));
        loadAFMap();
        return;
      }
    },
    { once: true }
  );
}

window.addEventListener("DOMContentLoaded", loadAFMap);
