import { db } from "../js/firebase-init.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

export async function generateQRCodeSheets(achatId) {

  const snap = await getDoc(doc(db,"achats",achatId));
  if (!snap.exists()) {
    alert("Achat introuvable");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit:"mm", format:"a4" });

  const url = `${location.origin}/pages/photo-batch.html?achatId=${achatId}`;

  const tmp = document.createElement("div");
  new QRCode(tmp, { text:url, width:256, height:256 });
  await new Promise(r => setTimeout(r,30));
  const canvas = tmp.querySelector("canvas");
  const img = canvas.toDataURL("image/png");

  pdf.setFontSize(20);
  pdf.text(`Réception achat`,10,20);
  pdf.text(`ID : ${achatId}`,10,28);

  pdf.addImage(img,"PNG",50,60,100,100);

  pdf.text(url,10,180);

  pdf.save(`QR-${achatId}.pdf`);
}
