// load-articles.js
import { db } from './firebase-init.js';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-lite.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#articles-list');

  async function loadArticles() {
    if (!tableBody) {
      console.error('[loadArticles] Table non trouvée');
      return;
    }

    tableBody.innerHTML = '<tr><td colspan="11">Chargement...</td></tr>';
    try {
      const authData = JSON.parse(localStorage.getItem("auth"));
      if (!authData || !authData.uid) {
        console.error("[loadArticles] Utilisateur non connecté");
        tableBody.innerHTML = '<tr><td colspan="11">Non connecté</td></tr>';
        return;
      }

      const snapshot = await getDocs(collection(db, `articles/${authData.uid}/items`));
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
    } catch (err) {
      console.error('[loadArticles] Erreur Firestore:', err);
      tableBody.innerHTML = '<tr><td colspan="11">Erreur de chargement</td></tr>';
    }
  }

  loadArticles();
  window.reloadArticles = loadArticles;
});

