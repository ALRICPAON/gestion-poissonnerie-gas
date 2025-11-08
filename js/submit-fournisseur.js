// submit-fournisseur.js
import { db, auth } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#fournisseur-form');
  if (!form) return;

  onAuthStateChanged(auth, (user) => {
    if (!user) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form));
      const id = data.code.trim();
      if (!id) return alert("Code fournisseur manquant");

      try {
        await setDoc(doc(db, 'fournisseurs', id), data);
        console.log('✅ Fournisseur ajouté :', id);
        form.reset();
        if (typeof window.reloadFournisseurs === 'function') window.reloadFournisseurs();
      } catch (err) {
        console.error('❌ Erreur ajout fournisseur :', err);
        alert("Erreur lors de l'ajout");
