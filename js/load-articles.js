import { db, auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#articles-list');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="11">Chargement…</td></tr>';

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      tableBody.innerHTML = '<tr><td colspan="11">Non connecté</td></tr>';
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
            <td></td> <!-- PV TTC -->
            <td>${data.Unite || ''}</td> <!-- €/kg ou pièce -->
            <td>${data.Allergenes || ''}</td>
            <td>${data.Zone || ''}</td>
            <td>${data.SousZone || ''}</td>
            <td>${data.Engin || ''}</td>
            <td></td> <!-- Décongelé -->
            <td></td> <!-- Type -->
          </tr>`;
        rows.push(row);
      });

      tableBody.innerHTML = rows.join('') || '<tr><td colspan="11">Aucun article</td></tr>';
    } catch (err) {
      console.error('[loadArticles] Erreur Firestore:', err);
      tableBody.innerHTML = '<tr><td colspan="11">Erreur de chargement</td></tr>';
    }
  });
});
