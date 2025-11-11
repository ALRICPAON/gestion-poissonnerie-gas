/**************************************************
 * AF-MAP MANAGER
 * — Détection refs manquantes
 * — Popup mapping (auto + recherche article)
 * — Enregistrement Firestore
 **************************************************/
import { db } from "./firebase-init.js";
import {
  doc, setDoc, getDocs, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**
 * missingRefs = [
 *   {fournisseurCode, refFournisseur, designation}
 * ]
 */
export async function manageAFMap(missingRefs = []) {
  console.log("✅ manageAFMap called", missingRefs);
  if (!missingRefs.length) return;

  await showAFMapPopup(missingRefs);
}

/***********************
 * Charger Articles
 ***********************/
async function loadArticles() {
  const snap = await getDocs(collection(db, "articles"));
  const out = [];
  snap.forEach(d => {
    const x = d.data();
    out.push({
      id: d.id,
      plu: x.plu ?? "",
      designation: x.designation ?? "",
      nomLatin: x.nomLatin ?? "",
    });
  });
  return out;
}

/**************************************************
 * MAIN POPUP
 **************************************************/
function showAFMapPopup(missingRefs) {
  console.log("🚨 showAFMapPopup CALLED");

  // ✅ Supprime overlay précédent (si déjà ouvert)
  document.querySelectorAll(".afmap-overlay").forEach(el => el.remove());

  // ✅ Overlay
  const overlay = document.createElement("div");
  overlay.className = "afmap-overlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.45)";
  overlay.style.zIndex = "9999";

  // ✅ Modal
  const modal = document.createElement("div");
  modal.className = "afmap-modal";
  modal.style.background = "#fff";
  modal.style.width = "600px";
  modal.style.margin = "60px auto";
  modal.style.padding = "20px";
  modal.style.borderRadius = "8px";

  modal.innerHTML = `
    <h2>Références fournisseur non mappées</h2>
    <p>Sélectionnez un PLU pour continuer.</p>
    <ul>
      ${missingRefs.map(x => `
        <li><b>${x.refFournisseur}</b> — ${x.designation}</li>
      `).join("")}
    </ul>

    <button id="afmap-close" style="margin-top:20px;">Fermer</button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById("afmap-close").onclick = () => overlay.remove();
}

    // Rendu des lignes
    list.innerHTML = missingRefs.map(item => `
      <div class="afmap-row" data-ref="${item.refFournisseur}">
        <div class="afmap-ref">
          <b>${item.refFournisseur}</b> — ${item.designation ?? ""}
        </div>
        <button class="btn btn-small afmap-map-btn" data-key="${item.fournisseurCode}__${item.refFournisseur}">
          Associer
        </button>
      </div>
    `).join("");

    /************************************
     * ASSOCIER → ouvrir choix articles
     ************************************/
    list.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("afmap-map-btn")) return;

      const key = e.target.dataset.key;
      const [fournisseurCode, refFournisseur] = key.split("__");

      const chosen = await showArticleSelector(articles);
      if (!chosen) return;

      await saveAFMap({
        fournisseurCode,
        refFournisseur,
        plu: chosen.plu,
        designationInterne: chosen.designation,
      });

      alert(`✅ Mappage enregistré : ${refFournisseur} → PLU ${chosen.plu}`);

      // Remove entry
      e.target.closest(".afmap-row")?.remove();
    });

    // CLOSE
    document.getElementById("afmap-close").addEventListener("click", () => {
      overlay.remove();
      resolve();
    });
  });
}


/**************************************************
 * SAVE
 **************************************************/
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


/**************************************************
 * Article selector
 **************************************************/
function showArticleSelector(articles) {
  return new Promise((resolve) => {

    // Overlay
    const o = document.createElement("div");
    o.className = "afmap-overlay";

    const w = document.createElement("div");
    w.className = "afmap-modal";

    w.innerHTML = `
      <h3>Associer un PLU</h3>

      <input type="text" id="afmap-search" placeholder="Rechercher…" class="afmap-search"/>

      <div class="afmap-tab"></div>

      <div style="text-align:right;margin-top:12px;">
        <button id="afmap-cancel" class="btn btn-muted">Annuler</button>
      </div>
    `;

    o.appendChild(w);
    document.body.appendChild(o);

    const tab = w.querySelector(".afmap-tab");
    const input = w.querySelector("#afmap-search");

    // Rendu
    function render(filter = "") {
      const f = filter.toLowerCase();
      const filtered = articles.filter(a =>
        a.plu.toLowerCase().includes(f) ||
        a.designation.toLowerCase().includes(f)
      );

      tab.innerHTML = filtered.map(a => `
        <div class="afmap-artrow" data-plu="${a.plu}" data-des="${a.designation}">
          <b>${a.plu}</b> — ${a.designation}
        </div>
      `).join("");
    }
    render();

    input.addEventListener("input", () => {
      render(input.value);
    });

    tab.addEventListener("click", (e) => {
      const row = e.target.closest(".afmap-artrow");
      if (!row) return;
      const plu = row.dataset.plu;
      const des = row.dataset.des;
      o.remove();
      resolve({ plu, designation: des });
    });

    w.querySelector("#afmap-cancel").addEventListener("click", () => {
      o.remove();
      resolve(null);
    });
  });
}
