/**************************************************
 * AF-MAP MANAGER (générique)
 * — Détection refs manquantes
 * — Popup mapping
 * — Enregistrement Firestore
 **************************************************/
import { db } from "./firebase-init.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**
 * Demande à l'utilisateur de mapper les références manquantes.
 * @param {Array} missingRefs — [{ fournisseurCode, refFournisseur, designation }]
 * @returns {Promise<void>}
 */
export async function manageAFMap(missingRefs = []) {

  if (!missingRefs.length) return;

  // ---- UI ----
  await showAFMapPopup(missingRefs);
}


/**
 * Ouvre une popup pour sélectionner un PLU
 * @param {*} missingRefs
 */
async function showAFMapPopup(missingRefs) {

  return new Promise((resolve) => {

    // Overlay
    const overlay = document.createElement("div");
    overlay.className = "afmap-overlay";

    // Modal
    const modal = document.createElement("div");
    modal.className = "afmap-modal";

    modal.innerHTML = `
      <h2>Références fournisseur non mappées</h2>

      <p>Ces références ne sont pas associées à un article interne.<br>
      Sélectionnez le PLU correspondant.</p>

      <div class="afmap-list"></div>

      <button id="afmap-close" class="btn btn-muted">Fermer</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector(".afmap-list");

    for (const item of missingRefs) {
      const row = document.createElement("div");
      row.className = "afmap-row";

      row.innerHTML = `
        <div class="afmap-ref">
          <b>${item.refFournisseur}</b> — ${item.designation ?? ""}
        </div>
        <button class="btn btn-small" data-key="${item.fournisseurCode}__${item.refFournisseur}">
          Associer
        </button>
      `;

      list.appendChild(row);
    }

    // Button action
    list.addEventListener("click", async (e) => {
      const key = e.target.dataset.key;
      if (!key) return;

      const [fournisseurCode, refFournisseur] = key.split("__");

      // --- Ouvrir sélection article (UI F9 existante)
      const chosen = await choosePLUForMapping();
      if (!chosen) return;

      await saveAFMap({
        fournisseurCode,
        refFournisseur,
        plu: chosen.plu,
        designationInterne: chosen.designationInterne,
      });

      alert(`✅ Mappage enregistré : ${refFournisseur} → PLU ${chosen.plu}`);

      // Remove entry
      e.target.closest(".afmap-row").remove();
    });

    document.getElementById("afmap-close").addEventListener("click", () => {
      overlay.remove();
      resolve();
    });
  });
}


/**
 * Enregistre AF_MAP
 */
async function saveAFMap({ fournisseurCode, refFournisseur, plu, designationInterne }) {
  const key = `${fournisseurCode}__${refFournisseur}`.toUpperCase();

  await setDoc(doc(db, "af_map", key), {
    fournisseurCode,
    refFournisseur,
    plu,
    designationInterne,
    updatedAt: serverTimestamp()
  }, { merge: true });
}


/**
 * Ouvre un sélecteur d’article (F9)
 * → tu as déjà quelque chose → on wrapper
 */
async function choosePLUForMapping() {
  return new Promise((resolve) => {

    // ✅ TODO — réutiliser la popup article existante
    // Enn attendant → prompt
    const plu = prompt("PLU ?");
    if (!plu) return resolve(null);

    resolve({
      plu,
      designationInterne: ""     // tu peux améliorer
    });
  });
}
