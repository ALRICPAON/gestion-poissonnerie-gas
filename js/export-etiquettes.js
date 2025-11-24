import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import ExcelJS from "https://cdn.jsdelivr.net/npm/exceljs/dist/exceljs.min.js";


// ----------------------
// 🔥 Normalisation Engin
// ----------------------
function canoniseEngin(v) {
  if (!v) return "";
  const s = v.toUpperCase().trim();

  if (s.includes("OTB")) return "Chalut OTB";
  if (s.includes("CHALUT")) return "Chalut OTB";
  if (s.includes("FILET")) return "Filet maillant";
  if (s.includes("LIGNE")) return "Ligne hameçon";
  return v;
}


// ----------------------
// 🔥 Charger infos d’un PLU
// ----------------------
async function getInfoPLU(plu) {
  // 1. LOT OUVERT ?
  const snapLots = await getDocs(
    query(collection(db, "lots"), where("plu", "==", plu), where("closed", "==", false))
  );

  if (!snapLots.empty) {
    const d = snapLots.docs[0].data();
    return {
      designation: d.designation,
      nomLatin: d.nomLatin || "",
      fao: d.fao || "",
      engin: canoniseEngin(d.engin),
      decongele: d.decongele ? "Oui" : "Non",
      allergenes: d.allergenes || "",
      prix: d.prixVenteKg || 0,
      type: d.type || "TRAD",
      criee: d.criee || ""
    };
  }

  // 2. SINON → Dernier achat
  const snapAchats = await getDocs(
    query(collection(db, "achats"), where("plu", "==", plu))
  );

  if (!snapAchats.empty) {
    const d = snapAchats.docs[0].data();
    return {
      designation: d.designation,
      nomLatin: d.nomLatin || "",
      fao: d.fao || "",
      engin: canoniseEngin(d.engin),
      decongele: d.decongele ? "Oui" : "Non",
      allergenes: d.allergenes || "",
      prix: d.prixKg || 0,
      type: "TRAD",
      criee: d.criee || ""
    };
  }

  // 3. SINON → Articles
  const snapArt = await getDoc(doc(db, "articles", plu));
  if (snapArt.exists()) {
    const d = snapArt.data();
    return {
      designation: d.designation,
      nomLatin: d.nomLatin || "",
      fao: d.fao || "",
      engin: canoniseEngin(d.engin),
      decongele: d.decongele ? "Oui" : "Non",
      allergenes: d.allergenes || "",
      prix: d.pv || 0,
      type: "TRAD",
      criee: ""
    };
  }

  return null;
}


// ----------------------
// 🔥 GENERER FICHIER EXCEL
// ----------------------
export async function exportEtiquettes() {
  const snapLots = await getDocs(query(collection(db, "lots"), where("closed", "==", false)));

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("_Etiquettes");

  ws.addRow([
    "type","criee","", "PLU","designation","Nom scientif","Méthode Prod",
    "Zone Pêche","Engin Pêche","Décongelé","Allergènes","Prix","€/kg ou Pièce"
  ]);

  const PLUs = new Set();

  snapLots.forEach(l => {
    const d = l.data();
    if (d.poidsRestant > 0) PLUs.add(d.plu);
  });

  for (const plu of PLUs) {
    const info = await getInfoPLU(plu);
    if (!info) continue;

    ws.addRow([
      info.type,
      info.criee,
      "",
      plu,
      info.designation,
      info.nomLatin,
      info.methode || "",
      info.fao,
      info.engin,
      info.decongele,
      info.allergenes,
      info.prix,
      "€/kg"
    ]);
  }

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "etiquettes_evolis.xlsx";
  a.click();
}
