// edit-fournisseur.js
import { db } from './firebase-init.js';
import { doc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#fournisseurs-list');
  if (!tableBody) return;

  tableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const row = btn.closest('tr');
    const id = row?.dataset?.id;
    if (!id) return;

    if (btn.classList.contains('delete-btn')) {
      if (confirm("Supprimer ce fournisseur ?")) {
        try {
          await deleteDoc(doc(db, 'fournisseurs', id));
          row.remove();
        } catch (err) {
          console.error('[deleteFournisseur] Erreur :', err);
          alert("Erreur suppression");
        }
      }
    }

    if (btn.classList.contains('edit-btn')) {
      const tds = row.querySelectorAll('td');
      const fields = ['code', 'nom', 'contact', 'telephone', 'email', 'adresse', 'notes'];
      const data = {};
      fields.forEach((field, i) => data[field] = prompt(`Modifier ${field}`, tds[i]?.textContent.trim() || '') ?? tds[i]?.textContent.trim());

      try {
        await updateDoc(doc(db, 'fournisseurs', id), data);
        if (typeof window.reloadFournisseurs === 'function') window.reloadFournisseurs();
      } catch (err) {
        console.error('[updateFournisseur] Erreur :', err);
        alert("Erreur mise à jour");
      }
    }
  });
