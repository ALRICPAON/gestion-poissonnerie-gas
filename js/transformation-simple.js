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
 * F9 = Recherche Article
 ***********************************************/
import {
  collection as colArticles,
  getDocs as getDocsArticles
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const popupF9 = document.getElementById("popup-f9");
const f9Search = document.getElementById("f9-search");
const f9TableBody = document.querySelector("#f9-table tbody");
const f9Close = document.getElementById("f9-close");

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
      return;
    }

    openF9();
  }
});

async function openF9() {
  popupF9.style.display = "flex";
  f9Search.value = "";
  f9Search.focus();

  // Charger articles
  const snap = await getDocsArticles(colArticles(db, "articles"));
  let rows = "";

  snap.forEach((d) => {
    const a = d.data();
    rows += `
      <tr data-plu="${a.plu}" data-des="${a.designation}">
        <td>${a.plu}</td>
        <td>${a.designation}</td>
      </tr>
    `;
  });

  f9TableBody.innerHTML = rows;
}

// Clic sur un article
f9TableBody.addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;

  const plu = tr.dataset.plu;

  if (currentF9Target === "plu-source") {
    pluSrcInput.value = plu;
  } else if (currentF9Target === "plu-final") {
    pluFinalInput.value = plu;
  }

  popupF9.style.display = "none";
});

// Filtre en live
f9Search.addEventListener("input", () => {
  const term = f9Search.value.toLowerCase();
  [...f9TableBody.querySelectorAll("tr")].forEach(tr => {
    const txt = tr.innerText.toLowerCase();
    tr.style.display = txt.includes(term) ? "" : "none";
  });
});

// Fermer
f9Close.addEventListener("click", () => {
  popupF9.style.display = "none";
});

