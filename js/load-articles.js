import { db, auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#articles-list');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="12">Chargement…</td></tr>';

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      tableBody.innerHTML = '<tr><td colspan="12">Non connecté</td></tr>';
      return;
    }

    try {
      const snapshot = await getDocs(collection(db, 'articles'));
      const rows = [];

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const row = `
          <tr data-id="${docSnap.id}">
            <td>${data.PLU || ''}</td>
            <td>${data.Designation || ''}</td>
            <td>${data.NomLatin || ''}</td>
            <td>${data.Categorie || ''}</td>
            <td>${data.Unite || ''}</td>
            <td>${data.Allergenes || ''}</td>
            <td>${data.Zone || ''}</td>
            <td>${data.SousZone || ''}</td>
            <td>${data.Engin || ''}</td>
            <td>${data.ean || ''}</td>
            <td>${data.rayon || ''}</td>
            <td>
              <button class="edit-btn">✏️</button>
              <button class="delete-btn">🗑️</button>
            </td>
          </tr>`;
        rows.push(row);
      });

      tableBody.innerHTML = rows.join('') || '<tr><td colspan="12">Aucun article</td></tr>';
    } catch (err) {
      console.error('[loadArticles] Erreur Firestore:', err);
      tableBody.innerHTML = '<tr><td colspan="12">Erreur de chargement</td></tr>';
    }
  });
});
