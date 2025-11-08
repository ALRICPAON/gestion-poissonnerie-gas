import { db } from './firebase-init.js';
import { setDoc, doc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { auth } from './firebase-init.js';

const jsonUrl = '../data/articles_firestore.json'; // adapte si tu changes d’emplacement

async function importerArticles() {
  const res = await fetch(jsonUrl);
  const data = await res.json();

  const entries = Object.entries(data); // [ [PLU, {Designation, ...}], ... ]

  for (const [plu, article] of entries) {
    try {
      await setDoc(doc(db, "articles", plu), article);
      console.log(`✅ Article ${plu} importé`);
    } catch (e) {
      console.error(`❌ Erreur pour ${plu}:`, e);
    }
  }

  alert("🎉 Import terminé !");
}

// Lancer après auth Firebase
window.__afterAuth = () => {
  importerArticles();
};
