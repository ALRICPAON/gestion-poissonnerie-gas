// load-fournisseurs.js
import { db, auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#fournisseurs-list');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="8">Chargement…</td></tr>';

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      tableBody.innerHTML = '<tr><td colspan="8">Non connecté</td></tr>';
      return;
    }

    try {
      const snapshot = await getDocs(collection(db, 'fournisseurs'));
      const rows = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        const row = `
          <tr data-id="${doc.id}">
            <td>${data.code || ''}</td>
            <td>${data.nom || ''}</td>
            <td>${data.contact || ''}</td>
            <td>${data.telephone || ''}</td>
            <td>${data.email || ''}</td>
            <td>${data.adresse || ''}</td>
            <td>${data.notes || ''}</td>
            <td class="actions">
              <button class="edit-btn">✏️</button>
              <button class="delete-btn">🗑️</button>
            </td>
          </tr>`;
        rows.push(row);
      });

      tableBody.innerHTML = rows.join('') || '<tr><td colspan="8">Aucun fournisseur</td></tr>';
    } catch (err) {
      console.error('[loadFournisseurs] Erreur Firestore:', err);
      tableBody.innerHTML = '<tr><td colspan="8">Erreur de chargement</td></tr>';
    }
  });
});
