import { db } from './firebase-init.js';
import { collection, setDoc, doc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

// ⚠️ Modifie ce chemin si le fichier est ailleurs
const jsonUrl = '../data/articles_firestore.json';

async function importerArticles() {
  const res = await fetch(jsonUrl);
  const articles = await res.json();

  for (const art of articles) {
    const id = String(art.PLU).replace('.0', '');  // ex: "3063"
    await setDoc(doc(db, "articles", id), art);
    console.log(`✅ Article ${id} importé`);
  }

  alert("🎉 Import terminé !");
}

window.__afterAuth = () => {
  importerArticles();
};
