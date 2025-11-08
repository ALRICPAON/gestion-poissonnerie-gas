import { db } from './firebase-init.js';
import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore-lite.js';

document.getElementById("article-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const PLU = form.plu.value.trim();
  const designation = form.designation.value.trim();
  const nomLatin = form.nomLatin.value.trim();
  const prixVenteTTC = parseFloat(form.prixVenteTTC.value);

  if (!PLU || !designation || !nomLatin || isNaN(prixVenteTTC)) {
    alert("Merci de remplir tous les champs correctement.");
    return;
  }

  await addDoc(collection(db, "articles"), {
    PLU,
    designation,
    nomLatin,
    prixVenteTTC
  });

  form.reset();
  window.reloadArticles();
});
