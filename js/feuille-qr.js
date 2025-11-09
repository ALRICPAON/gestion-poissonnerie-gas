import { db } from "../js/firebase-init.js";
import {
  doc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

async function main(){
  const params = new URLSearchParams(location.search);
  const achatId = params.get("achatId");

  if (!achatId){
    document.querySelector("#main").innerHTML = "❌ achatId manquant";
    return;
  }

  const lignesCol = collection(doc(db,"achats",achatId), "lignes");
  const snap = await getDocs(lignesCol);

  // group by fournisseur
  const groups = {};   // { fournisseur → [ligne,…] }

  snap.forEach(d => {
    const L = d.data();
    const f = L.fournisseurNom || "Inconnu";
    if (!groups[f]) groups[f] = [];

    groups[f].push({
      plu: L.plu,
      designation: L.designation,
      poids: L.poidsTotalKg,
      lot: L.lot,
      qr_url: L.qr_url
    });
  });

  const main = document.querySelector("#main");
  main.innerHTML = "";

  Object.entries(groups).forEach(([fourn, arr])=>{
    const div = document.createElement("div");
    div.className = "group";

    const h = document.createElement("h2");
    h.textContent = `Fournisseur : ${fourn}`;
    div.appendChild(h);

    const list = document.createElement("div");
    list.className = "qr-row";

    arr.forEach(L=>{
      const item = document.createElement("div");
      item.className = "qr-item";

      item.innerHTML = `
        <div><strong>${L.plu || ""}</strong></div>
        <div>${L.designation || ""}</div>
        <div>${L.poids ? (L.poids+" kg") : ""}</div>
        <div id="qr-${L.lot}"></div>
        <div>${L.lot}</div>
      `;

      list.appendChild(item);

      // regenerer QR si besoin
      setTimeout(()=>{
        new QRCode(
          document.getElementById(`qr-${L.lot}`),
          L.qr_url || ""
        );
      },10);
    });

    div.appendChild(list);
    main.appendChild(div);
  });
}

main();
