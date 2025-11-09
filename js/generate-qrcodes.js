import { db } from "../js/firebase-init.js";
import {
  doc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Génération PDF QR
export async function generateQRCodeSheets(achatId) {
  if (!achatId) {
    alert("Achat introuvable");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });

  const lignesCol = collection(doc(db, "achats", achatId), "lignes");
  const snap = await getDocs(lignesCol);

  // group by fournisseur
  const groups = {};

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

  let y = 10;

  for (const [fourn, arr] of Object.entries(groups)) {

    pdf.setFontSize(14);
    pdf.text(`Fournisseur : ${fourn}`, 10, y);
    y += 8;

    for (const L of arr) {

      // Générer un QR à la volée
      const tmp = document.createElement("div");
      const qr = new QRCode(tmp, {
        text: L.lot,
        width: 128,
        height: 128
      });

      await new Promise(res => setTimeout(res, 50));

      const canvas = tmp.querySelector("canvas");
      const imgData = canvas.toDataURL("image/png");

      // Ajout dans PDF
      pdf.addImage(imgData, "PNG", 10, y, 30, 30);

      pdf.setFontSize(10);
      pdf.text(`PLU : ${L.plu || ""}`, 45, y + 5);
      pdf.text(`Produit : ${L.designation || ""}`, 45, y + 10);
      pdf.text(`Poids : ${(L.poids ?? "") + " kg"}`, 45, y + 15);
      pdf.text(`Lot : ${L.lot}`, 45, y + 20);

      y += 40;

      // Nouvelle page si trop bas
      if (y > 260) {
        pdf.addPage();
        y = 10;
      }
    }

    y += 10;

    if (y > 260) {
      pdf.addPage();
      y = 10;
    }
  }

  pdf.save(`QR-${achatId}.pdf`);
  alert("✅ PDF téléchargé");
}
