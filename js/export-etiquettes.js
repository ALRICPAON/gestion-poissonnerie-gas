import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ExcelJS global (chargé par <script> dans HTML)
const ExcelJS = window.ExcelJS;

/* ----------------------------------------------
   🔧 Canonisation Engin (pour affichage propre)
---------------------------------------------- */
function canoniseEngin(v) {
  if (!v) return "";
  const s = v.toUpperCase().trim();

  if (s.includes("OTB")) return "Chalut OTB";
  if (s.includes("CHALUT")) return "Chalut OTB";
  if (s.includes("FILET")) return "Filet maillant";
  if (s.includes("LIGNE")) return "Ligne hameçon";

  return v;
}

/* ----------------------------------------------
   🔥 Récupère toutes les infos d’un PLU
   Priorité : LOT > Achat > Article (fallback)
---------------------------------------------- */
async function getInfoPLU(plu) {
  const qLots = query(
    collection(db, "lots"),
    where("plu", "==", plu),
    where("closed", "==", false)
  );

  const snapLots = await getDocs(qLots);

  // 1️⃣ LOT (prioritaire)
  if (!snapLots.empty) {
    const d = snapLots.docs[0].data();
    return {
      type: d.type || "TRAD",
      criee: d.criee || "",
      designation: d.designation || "",
      nomLatin: d.nomLatin || "",
      fao: d.fao || "",
      engin: canoniseEngin(d.engin),
      decongele: d.decongele ? "Oui" : "Non",
      allergenes: d.allergenes || "",
      prix: d.prixVenteKg || 0,
      unite: "€/kg",
    };
  }

  // 2️⃣ ACHAT
  const snapAchats = await getDocs(
    query(collection(db, "achats"), where("plu", "==", plu))
  );

  if (!snapAchats.empty) {
    const d = snapAchats.docs[0].data();
    return {
      type: "TRAD",
      criee: d.criee || "",
      designation: d.designation || "",
      nomLatin: d.nomLatin || "",
      fao: d.fao || "",
      engin: canoniseEngin(d.engin),
      decongele: d.decongele ? "Oui" : "Non",
      allergenes: d.allergenes || "",
      prix: d.prixKg || 0,
      unite: "€/kg",
    };
  }

  // 3️⃣ ARTICLE (fallback)
  const snapArt = await getDoc(doc(db, "articles", plu));
  if (snapArt.exists()) {
    const d = snapArt.data();
    return {
      type: "TRAD",
      criee: "",
      designation: d.designation || "",
      nomLatin: d.nomLatin || "",
      fao: d.fao || "",
      engin: canoniseEngin(d.engin),
      decongele: d.decongele ? "Oui" : "Non",
      allergenes: d.allergenes || "",
      prix: d.pvTTCreel || d.pv || 0,
      unite: "€/kg",
    };
  }

  return null;
}

/* ----------------------------------------------
   📤 GENERATE XLSX
---------------------------------------------- */
export async function exportEtiquettes() {
  console.log("⏳ Export étiquettes…");

  const snapLots = await getDocs(
    query(collection(db, "lots"), where("closed", "==", false))
  );

  const PLUs = new Set();
  snapLots.forEach(l => {
    const d = l.data();
    if (d.poidsRestant > 0) PLUs.add(d.plu);
  });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("_Etiquettes");

  // En-têtes EXACTS
  ws.addRow([
    "type","criee","", "PLU","designation","Nom scientif","Méthode Prod",
    "Zone Pêche","Engin Pêche","Décongelé","Allergènes","Prix","€/kg ou Pièce"
  ]);

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
      "", // Méthode Prod (non gérée encore)
      info.fao,
      info.engin,
      info.decongele,
      info.allergenes,
      info.prix,
      info.unite
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

  console.log("✅ Export terminé !");
}
