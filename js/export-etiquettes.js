import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ExcelJS global
const ExcelJS = window.ExcelJS;

/* ---------------------------------------------------------
   🔧 Canonisation Engin (format cohérent Evolis)
--------------------------------------------------------- */
function canoniseEngin(v) {
  if (!v) return "";
  const s = v.toUpperCase().trim();

  if (s.includes("OTB")) return "Chalut OTB";
  if (s.includes("CHALUT")) return "Chalut OTB";
  if (s.includes("FILET")) return "Filet maillant";
  if (s.includes("LIGNE")) return "Ligne hameçon";

  return v;
}

/* ---------------------------------------------------------
   🔥 AGRÉGER TOUTES LES VALEURS MULTIPLES (lots)
--------------------------------------------------------- */
function uniqValues(values) {
  return [...new Set(values.filter(v => v && v.trim() !== ""))].join(", ");
}

/* ---------------------------------------------------------
   🔥 Récupérer TOUTES LES INFOS d’un PLU
   Ordre :
     1) lots ouverts (multi valeurs)
     2) achats (si aucune info en lot)
     3) articles (fallback)
     + stock_articles pour pvTTCreel
--------------------------------------------------------- */
async function getInfoPLU(plu) {

  /* ----------------------
     LOTS (toutes valeurs)
  ---------------------- */
  const snapLots = await getDocs(
    query(collection(db, "lots"), where("plu", "==", plu), where("closed", "==", false))
  );

  let designations = [];
  let nomsLatin = [];
  let faos = [];
  let engins = [];
  let decongeles = [];
  let allergenesLots = [];
  let methodesProd = [];   // 🔥 liste des méthodes

  snapLots.forEach(lot => {
    const d = lot.data();
    designations.push(d.designation || "");
    nomsLatin.push(d.nomLatin || "");
    faos.push(d.fao || "");
    engins.push(canoniseEngin(d.engin));
    decongeles.push(d.decongele ? "Oui" : "Non");
    allergenesLots.push(d.allergenes || "");

    // 🔥 Méthode Prod depuis LOT
    methodesProd.push(
      d.Categorie || d.categorie || d.Elevage || d.methodeProd || ""
    );
  });

  const hasLots = !snapLots.empty;


  /* ----------------------
     STOCK ARTICLES (PV TTC RÉEL)
  ---------------------- */
  let pvReal = 0;
  const snapStockArt = await getDoc(doc(db, "stock_articles", "PLU_" + plu));
  if (snapStockArt.exists()) {
    pvReal = snapStockArt.data().pvTTCreel || 0;
  }


  /* ----------------------
     ACHAT fallback (si pas lot)
  ---------------------- */
  let achatData = null;
  let achatMethode = "";

  const snapAchats = await getDocs(
    query(collection(db, "achats"), where("plu", "==", plu))
  );

  if (!snapAchats.empty) {
    achatData = snapAchats.docs[0].data();

    // 🔥 Méthode prod achat
    achatMethode =
      achatData?.Categorie ||
      achatData?.categorie ||
      achatData?.Elevage ||
      achatData?.methodeProd ||
      "";
  }


  /* ----------------------
     ARTICLE fallback
  ---------------------- */
  const snapArt = await getDoc(doc(db, "articles", plu));
  let artData = snapArt.exists() ? snapArt.data() : {};

  // 🔥 Méthode prod fiche article
  const artMethode =
    artData?.Categorie ||
    artData?.categorie ||
    artData?.Elevage ||
    artData?.methodeProd ||
    "";


  /* ----------------------
     OBJECT FINAL
  ---------------------- */
  return {
    type: "TRAD",

    criee: hasLots
      ? uniqValues(snapLots.docs.map(l => l.data().criee || ""))
      : (achatData?.criee || ""),

    designation:
      uniqValues(designations) ||
      achatData?.designation ||
      artData?.Designation ||
      artData?.designation ||
      "",

    nomLatin:
      uniqValues(nomsLatin) ||
      achatData?.nomLatin ||
      artData?.NomLatin ||
      artData?.nomLatin ||
      "",

    fao:
      uniqValues(faos) ||
      achatData?.fao ||
      artData?.Zone ||
      artData?.zone ||
      "",

    engin:
      uniqValues(engins) ||
      canoniseEngin(achatData?.engin) ||
      canoniseEngin(artData?.Engin) ||
      canoniseEngin(artData?.engin) ||
      "",

    decongele:
      uniqValues(decongeles) ||
      (achatData?.decongele ? "Oui" : "Non") ||
      (artData?.decongele ? "Oui" : "Non") ||
      "Non",

    allergenes:
      uniqValues(allergenesLots) ||
      achatData?.Allergenes ||
      achatData?.allergenes ||
      artData?.Allergenes ||
      artData?.allergenes ||
      "",

    methodeProd:
      uniqValues(methodesProd) ||   // 🔥 valeurs de lots
      achatMethode ||               // 🔥 achat
      artMethode ||                 // 🔥 article
      "",

    prix: pvReal || 0,
    unite: artData?.Unite || "€/kg",
  };
}


/* ---------------------------------------------------------
   📤 EXPORT XLSX
--------------------------------------------------------- */
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

    ws.addRow([
      info.type,
      info.criee,
      "",
      plu,
      info.designation,
      info.nomLatin,
      info.methodeProd,
      info.fao,
      info.engin,
      "",   // colonne Décongelé volontairement vide
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
