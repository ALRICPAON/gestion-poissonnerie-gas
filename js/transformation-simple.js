import { db } from "./firebase-init.js";
import {
  collection, query, where, orderBy, getDocs,
  addDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const qs = s => document.querySelector(s);

const form = qs("#form-trans-simple");
const pluSrcInput = qs("#plu-source");
const poidsSrcInput = qs("#poids-source");
const pluFinalInput = qs("#plu-final");
const poidsFinalInput = qs("#poids-final");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const pluSource = pluSrcInput.value.trim();
  const poidsSource = Number(poidsSrcInput.value);
  const pluFinal = pluFinalInput.value.trim();
  const poidsFinal = Number(poidsFinalInput.value);

  if (!pluSource || !poidsSource || !pluFinal || !poidsFinal) {
    alert("Tous les champs sont obligatoires.");
    return;
  }

  // 1️⃣ Charger les lots FIFO du PLU source
  const lots = await loadLotsFIFO(pluSource);
  if (!lots.length) {
    alert("Aucun lot disponible pour ce PLU !");
    return;
  }

  // 2️⃣ Consommer du plus vieux lot
  let resteAConsommer = poidsSource;
  let coutTotal = 0;
  let consos = [];

  for (const docLot of lots) {
    const lot = docLot.data();
    let disponible = lot.poidsRestant;

    if (resteAConsommer <= 0) break;

    const conso = Math.min(disponible, resteAConsommer);

    // coût (PMA)
    coutTotal += conso * lot.prixAchatKg;

    // maj poids restant
    await updateDoc(doc(db, "lots", docLot.id), {
      poidsRestant: disponible - conso,
      closed: disponible - conso <= 0,
      updatedAt: serverTimestamp()
    });

    consos.push({
      lotId: docLot.id,
      plu: pluSource,
      poidsConsomme: conso,
      prixKg: lot.prixAchatKg
    });

    // mouvement sortie
    await addDoc(collection(db, "stock_movements"), {
      type: "TRANSFORMATION",
      sens: "sortie",
      lotId: docLot.id,
      plu: pluSource,
      poids: -conso,
      date: serverTimestamp()
    });

    resteAConsommer -= conso;
  }

  if (resteAConsommer > 0) {
    alert("Pas assez de stock disponible !");
    return;
  }

  // 3️⃣ Calcul du CUMP final
  const prixFinal = coutTotal / poidsFinal;

  // 4️⃣ Création du lot produit fini
  const lotFinal = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    designation: "",
    poidsInitial: poidsFinal,
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinal,
    transformationType: "simple",
    composants: consos,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closed: false
  });

  // 5️⃣ Mouvement entrée
  await addDoc(collection(db, "stock_movements"), {
    type: "TRANSFORMATION",
    sens: "entrée",
    lotId: lotFinal.id,
    plu: pluFinal,
    poids: poidsFinal,
    date: serverTimestamp()
  });

  alert("Transformation enregistrée !");
  form.reset();
});

async function loadLotsFIFO(plu) {
  const qRef = query(
    collection(db, "lots"),
    where("plu", "==", plu),
    where("poidsRestant", ">", 0),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(qRef);
  return snap.docs;
}
/***********************************************
 * F9 Articles — Version officielle (même que Achats)
 ***********************************************/
import {
  collection as colArticles,
  getDocs as getDocsArticles
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const popupF9 = document.getElementById("popup-f9");
const f9Search = document.getElementById("f9-search");
const f9TableBody = document.querySelector("#f9-table tbody");
const f9Close = document.getElementById("f9-close");

let f9Cache = [];
let currentF9Target = null;

// OUVERTURE AVEC F9
document.addEventListener("keydown", (e) => {
  if (e.key === "F9") {
    e.preventDefault();

    if (document.activeElement.id === "plu-source") {
      currentF9Target = "plu-source";

    } else if (document.activeElement.id === "plu-final") {
      currentF9Target = "plu-final";

    } else {
      return; // pas dans un champ PLU → ne rien faire
    }

    openF9();
  }
});

async function openF9() {
  popupF9.style.display = "flex";
  f9Search.value = "";
  f9Search.focus();

  if (f9Cache.length === 0) {
    const snap = await getDocsArticles(colArticles(db, "articles"));

    snap.forEach(d => {
      const a = d.data();
      f9Cache.push({
        plu: a.PLU || a.plu || d.id,
        designation: a.Designation || a.designation || "",
        nomLatin: a.NomLatin || a.nomLatin || "",
        categorie: a.Categorie || a.categorie || ""
      });
    });
  }

  renderF9Table();
}

// Affichage des lignes
function renderF9Table(filter = "") {
  const q = filter.toLowerCase();

  const rows = f9Cache.filter(a =>
    (`${a.plu} ${a.designation} ${a.nomLatin}`).toLowerCase().includes(q)
  );

  f9TableBody.innerHTML = rows.map(a => `
    <tr data-plu="${a.plu}" data-des="${a.designation}">
      <td>${a.plu}</td>
      <td>${a.designation}</td>
    </tr>
  `).join("") || `<tr><td colspan="2">Aucun article</td></tr>`;

  // Choix article
  f9TableBody.querySelectorAll("tr[data-plu]").forEach(tr => {
    tr.addEventListener("dblclick", () => selectF9(tr));
  });
}

function selectF9(tr) {
  const plu = tr.dataset.plu;
  const des = tr.dataset.des;

  if (currentF9Target === "plu-source") {
    document.getElementById("plu-source").value = plu;

  } else if (currentF9Target === "plu-final") {
    document.getElementById("plu-final").value = plu;
  }

  popupF9.style.display = "none";
}

// Filtre live
f9Search.addEventListener("input", () => {
  renderF9Table(f9Search.value);
});

// Fermer
f9Close.addEventListener("click", () => {
  popupF9.style.display = "none";
});
