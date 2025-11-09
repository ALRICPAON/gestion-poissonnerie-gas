import { db } from "../js/firebase-init.js";
import { collection, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { editAFMap } from "./edit-af-map.js";

const col = collection(db, "af_map");

export async function loadAFMap() {
  const list = document.getElementById("list");
  list.innerHTML = "<p>Chargement...</p>";

  const snap = await getDocs(col);

  let html = `
    <table>
      <tr>
        <th>Code</th>
        <th>Nom Fourn.</th>
        <th>Réf</th>
        <th>PLU</th>
        <th>Désignation</th>
        <th>Actions</th>
      </tr>
  `;

  snap.forEach(d => {
    const r = d.data();

    html += `
      <tr>
        <td>${r.fournisseurCode || ""}</td>
        <td>${r.fournisseurNom || ""}</td>
        <td>${r.refFournisseur || ""}</td>
        <td>${r.plu || ""}</td>
        <td>${r.designationInterne || ""}</td>
        <td>
          <button onclick="editAFMap('${d.id}')">✏️</button>
          <button onclick="deleteAFMap('${d.id}')">🗑️</button>
        </td>
      </tr>
    `;
  });

  html += "</table>";
  list.innerHTML = html;
}

window.deleteAFMap = async function(id) {
  if (!confirm("Supprimer ?")) return;
  await deleteDoc(doc(col, id));
  loadAFMap();
};

window.onload = loadAFMap;
