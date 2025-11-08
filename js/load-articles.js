import { db, auth } from './firebase-init.js';
import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import {
  collection,
  getDocs
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore-lite.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#articles-list');

  function renderArticles(snapshot) {
    const rows = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const row = `
        <tr data-id="${doc.id}">
          <td>${data.plu || ''}</td>
          <td>${data.designation || ''}</td>
          <td>${data.nomLatin || ''}</td>
          <td>${data.pvTTC || ''}</td>
          <td>${data.allergenes || ''}</td>
          <td>${data.zone || ''}</td>
          <td>${data.sousZone || ''}</td>
          <td>${data.engin || ''}</td>
          <td>${data.decongele ? 'Oui' : 'Non'}</td>
          <td>${data.type || ''}</td>
          <td>
            <button class="edit-btn">✏️</button>
            <button class="delete-btn">🗑️</button>
          </td>
        </tr>`;
      rows.push(row);
    });
    tableBody.innerHTML = rows.join('') || '<tr><td colspan="11">Aucun article</td></tr>';
  }

  function showError(message) {
    tableBody.innerHTML = `<tr><td colspan="11">${message}</td></tr>`;
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      console.error("[loadArticles] Utilisateur non connecté");
      showError("Non connecté");
      return;
    }

    tableBody.innerHTML = '<tr><td colspan="11">Chargement...</td></tr>';

    try {
      const snapshot = await getDocs(collection(db, `articles/${user.uid}/items`));
      renderArticles(snapshot);
    } catch (err) {
      console.error('[loadArticles] Erreur Firestore:', err);
      showError("Erreur de chargement");
    }
  });
});
