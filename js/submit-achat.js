import { db } from "../js/firebase-init.js";
import {
  collection, doc, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const achatsCol = collection(db, "achats");

function nz(v){ return (v==null?"":String(v).trim()); }
function toDateTS(iso) {
  // "YYYY-MM-DD" -> Timestamp
  if (!iso) return Timestamp.fromDate(new Date());
  return Timestamp.fromDate(new Date(iso + "T12:00:00")); // midi pour éviter TZ edge
}

async function createAchat({ type }) {
  // mini formulaire via prompt (simple); on fera un vrai formulaire sur la page détail
  const todayISO = new Date().toISOString().slice(0,10);
  const dateISO  = prompt("Date (AAAA-MM-JJ)", todayISO) ?? todayISO;
  const fournisseurCode = prompt("Code fournisseur (optionnel)", "") ?? "";
  const fournisseurNom  = prompt("Nom fournisseur", "") ?? "";
  const designationFournisseur = prompt("Désignation fournisseur (ex: BL/Commande ref)", "") ?? "";

  const ref = doc(achatsCol); // id auto
  const now = new Date();

  await setDoc(ref, {
    date: toDateTS(dateISO),
    fournisseurCode: nz(fournisseurCode),
    fournisseurNom: nz(fournisseurNom),
    designationFournisseur: nz(designationFournisseur),
    montantHT: 0,
    montantTTC: 0,
    type: type === "BL" ? "BL" : "commande",
    statut: "new",
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now)
  });

  // rediriger vers la page détail
  location.href = `./achat-detail.html?id=${encodeURIComponent(ref.id)}`;
}

window.addEventListener("DOMContentLoaded", () => {
  const btnCmd = document.getElementById("btnNewCommande");
  const btnBL  = document.getElementById("btnNewBL");
  if (btnCmd) btnCmd.addEventListener("click", () => createAchat({ type:"commande" }));
  if (btnBL)  btnBL.addEventListener("click",  () => createAchat({ type:"BL" }));
});
