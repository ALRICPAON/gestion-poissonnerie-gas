// 📄 Génération de feuilles QR par fournisseur à partir des lignes d’achat
// Utilise jsPDF pour créer un PDF par fournisseur avec : PLU, désignation, poids, QR

import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";
import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm";
import { getDocs, collection, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

export async function generateQRCodeSheets(achatId) {
  const achatRef = doc(db, "achats", achatId);
  const lignesRef = collection(achatRef, "lignes");
  const snapshot = await getDocs(lignesRef);

  const fournisseurs = {}; // regroupe par fournisseur

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (!data.received) continue;

    const fournisseur = data.fournisseur || "Inconnu";
    if (!fournisseurs[fournisseur]) fournisseurs[fournisseur] = [];
    fournisseurs[fournisseur].push({
      plu: data.plu,
      designation: data.designation,
      poids: data.poids_total,
      qr_url: data.qr_url,
      lot: data.lot
    });
  }

  for (const [fournisseur, lignes] of Object.entries(fournisseurs)) {
    const doc = new jsPDF();
    let x = 10, y = 10;
    let count = 0;

    for (const ligne of lignes) {
      if (count && count % 4 === 0) { doc.addPage(); x = 10; y = 10; }

      doc.setFontSize(10);
      doc.text(`PLU : ${ligne.plu}`, x, y);
      doc.text(`Désignation : ${ligne.designation}`, x, y + 5);
      doc.text(`Poids : ${ligne.poids ?? "?"} kg`, x, y + 10);

      if (ligne.qr_url?.startsWith("data:image")) {
        doc.addImage(ligne.qr_url, "PNG", x, y + 15, 30, 30);
      } else if (ligne.lot) {
        const qrData = await QRCode.toDataURL(`/pages/lot.html?id=${ligne.lot}`);
        doc.addImage(qrData, "PNG", x, y + 15, 30, 30);
      }

      y += 50; count++;
      if (y > 250) { doc.addPage(); y = 10; }
    }

    doc.save(`QR-${fournisseur}.pdf`);
  }
}
