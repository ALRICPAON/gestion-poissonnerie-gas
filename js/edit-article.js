import { db } from './firebase-init.js';
import { doc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const table = document.querySelector('#articles-list');

  table.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr');
    const articleId = tr?.dataset?.id;
    if (!articleId) return;

    // 🔴 Suppression
    if (e.target.classList.contains('delete-btn')) {
      const ok = confirm('🗑️ Supprimer cet article ?');
      if (ok) {
        await deleteDoc(doc(db, 'articles', articleId));
        tr.remove();
        console.log(`🗑️ Article ${articleId} supprimé`);
      }
      return;
    }

    // ✏️ Édition
    if (e.target.classList.contains('edit-btn')) {
      const cells = tr.querySelectorAll('td');
      const fields = [
        'PLU', 'Designation', 'NomLatin', 'Categorie', 'Unite',
        'Allergenes', 'Zone', 'SousZone', 'Engin',
        'ean', 'rayon'
      ];

      const data = {};
      fields.forEach((field, i) => {
        const oldVal = cells[i]?.textContent?.trim() || '';
        const newVal = prompt(`Modifier ${field} :`, oldVal);
        if (newVal !== null) data[field] = newVal;
      });

      await updateDoc(doc(db, 'articles', articleId), data);
      console.log(`✏️ Article ${articleId} modifié`);
      window.location.reload();
    }
  });
});
