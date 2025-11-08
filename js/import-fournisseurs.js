// import-fournisseurs.js
import { db } from './firebase-init.js';
import { collection, doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const jsonUrl = '../data/fournisseurs_firestore.json';

async function importerFournisseurs() {
  const res = await fetch(jsonUrl);
  const fournisseurs = await res.json();

  for (const { id, data } of fournisseurs) {
    try {
      await setDoc(doc(db, 'fournisseurs', id), data);
      console.log(`✅ Fournisseur importé : ${id}`);
    } catch (err) {
      console.error(`❌ Erreur import ${id} :`, err);
    }
  }

  alert('🎉 Import des fournisseurs terminé !');
}

// Lancer après login Firebase
window.__afterAuth = () => {
  importerFournisseurs();
};
