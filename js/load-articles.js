// load-articles.js
import { db } from './firebase-init.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-lite.js';

const tableBody = document.querySelector('#articles-table tbody');

async function loadArticles() {
  tableBody.innerHTML = '<tr><td colspan="10">Chargement...</td></tr>';
  try {
    const snapshot = await getDocs(collection(db, 'articles'));
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
    tableBody.innerHTML = rows.join('') || '<tr><td colspan="10">Aucun article</td></tr>';
  } catch (err) {
    console.error('[loadArticles] Erreur Firestore:', err);
    tableBody.innerHTML = '<tr><td colspan="10">Erreur de chargement</td></tr>';
  }
}

// Appel automatique
loadArticles();

// Exporte pour usage externe (ex : après ajout/modif)
window.reloadArticles = loadArticles;
