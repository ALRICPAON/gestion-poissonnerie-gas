import { db, auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { setDoc, doc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#article-form');
  if (!form) return;

  onAuthStateChanged(auth, (user) => {
    if (!user) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      const id = (data.plu || '').trim();

      if (!id) {
        alert("Le champ PLU est obligatoire");
        return;
      }

      // Construction de l’objet complet à enregistrer
      const article = {
        PLU: id,
        Designation: data.designation || '',
        NomLatin: data.nomLatin || '',
        Categorie: data.categorie || '',
        Unite: data.unite || '',
        Allergenes: '',
        Zone: '',
        SousZone: '',
        Engin: ''
      };

      try {
        await setDoc(doc(db, 'articles', id), article);
        console.log('✅ Article ajouté :', id);
       if (typeof window.reloadArticles === 'function') {
  window.reloadArticles();
}
        form.reset();
      } catch (err) {
        console.error('❌ Erreur ajout article :', err);
        alert("Erreur lors de l’ajout. Vérifie la console.");
      }
    });
  });
});
