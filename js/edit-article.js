import { db } from './firebase-init.js';
import { doc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-lite.js';

document.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".edit-btn");
  const deleteBtn = e.target.closest(".delete-btn");

  if (editBtn) {
    const row = editBtn.closest("tr");
    const docId = row.dataset.id;

    const newPLU = prompt("Modifier le PLU :", row.cells[0].textContent);
    const newDesignation = prompt("Modifier la désignation :", row.cells[1].textContent);
    const newNomLatin = prompt("Modifier le nom latin :", row.cells[2].textContent);
    const newPV = prompt("Modifier le prix de vente TTC :", row.cells[3].textContent);

    if (newPLU && newDesignation && newNomLatin && newPV) {
      const ref = doc(db, "articles", docId);
      await updateDoc(ref, {
        PLU: newPLU,
        designation: newDesignation,
        nomLatin: newNomLatin,
        prixVenteTTC: parseFloat(newPV)
      });
      window.reloadArticles();
    }
  }

  if (deleteBtn) {
    const row = deleteBtn.closest("tr");
    const docId = row.dataset.id;
    if (confirm("Supprimer cet article ?")) {
      const ref = doc(db, "articles", docId);
      await deleteDoc(ref);
      window.reloadArticles();
    }
  }
});
