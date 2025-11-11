/**************************************************
 * AF-MAP MANAGER
 * — Détection refs manquantes
 * — Popup mapping (recherche article)
 * — Enregistrement Firestore
 **************************************************/
import { db } from "./firebase-init.js";
import {
  doc,
  setDoc,
  getDocs,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";


/**
 * missingRefs = [
 *   { fournisseurCode, refFournisseur, designation }
 * ]
 */
export async function manageAFMap(missingRefs = []) {
  console.log("✅ manageAFMap called", missingRefs);

  if (!missingRefs.length) return;

  const articles = await loadArticles();
  await showAFMapPopup(missingRefs, articles);
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

  console.log("✅ Articles loaded:", out.length);
  return out;
}


/**************************************************
 * UI POPUP principale (liste des refs manquantes)
 **************************************************/
function showAFMapPopup(missingRefs, articles) {
  console.log("🚨 showAFMapPopup CALLED");

  return new Promise((resolve) => {

    // ✅ Supprime overlay précédent
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
    modal.style.width = "640px";
    modal.style.margin = "60px auto";
    modal.style.padding = "20px";
    modal.style.borderRadius = "8px";

    modal.innerHTML = `
      <h2 style="margin-top:0;">Références fournisseur non mappées</h2>
      <p>Sélectionnez un PLU interne.</p>

      <div class="afmap-list"></div>

      <div style="text-align:right;margin-top:20px;">
        <button id="afmap-close" class="btn btn-muted">Fermer</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector(".afmap-list");

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
     * ASSOCIER → popup choix article
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

      // Remove line
      e.target.closest(".afmap-row")?.remove();
    });


    // ✅ CLOSE
    modal.querySelector("#afmap-close").onclick = () => {
      overlay.remove();
      resolve();
    };
  });
}


/**************************************************
 * SAVE mapping → Firestore
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
 * Popup sélection article
 **************************************************/
function showArticleSelector(articles) {
  return new Promise((resolve) => {

    // ✅ Overlay
    const o = document.createElement("div");
    o.className = "afmap-overlay";
    o.style.position = "fixed";
    o.style.inset = "0";
    o.style.background = "rgba(0,0,0,0.45)";
    o.style.zIndex = "9999";

    // ✅ Window
    const w = document.createElement("div");
    w.className = "afmap-modal";
    w.style.background = "#fff";
    w.style.width = "600px";
    w.style.margin = "60px auto";
    w.style.padding = "20px";
    w.style.borderRadius = "8px";

    w.innerHTML = `
      <h3 style="margin-top:0;">Associer un PLU</h3>

      <input type="text" id="afmap-search" placeholder="Rechercher…" class="afmap-search"
        style="width:100%;padding:6px;margin-bottom:10px;"/>

      <div class="afmap-tab" style="max-height:50vh;overflow-y:auto;"></div>

      <div style="text-align:right;margin-top:12px;">
        <button id="afmap-cancel" class="btn btn-muted">Annuler</button>
      </div>
    `;

    o.appendChild(w);
    document.body.appendChild(o);

    const tab = w.querySelector(".afmap-tab");
    const input = w.querySelector("#afmap-search");


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

    input.addEventListener("input", () => render(input.value));


    tab.addEventListener("click", (e) => {
      const row = e.target.closest(".afmap-artrow");
      if (!row) return;

      const plu = row.dataset.plu;
      const des = row.dataset.des;

      o.remove();
      resolve({ plu, designation: des });
    });

    w.querySelector("#afmap-cancel").onclick = () => {
      o.remove();
      resolve(null);
    };
  });
}
