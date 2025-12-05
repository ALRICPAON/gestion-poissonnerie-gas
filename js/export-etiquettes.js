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
   🔧 Normalisation & déduplication intelligente
--------------------------------------------------------- */

/** Normalise un champ FAO pour comparaison et affichage */
function normalizeFAOKey(raw) {
  if (!raw) return "";
  let s = String(raw).trim();

  // collapse multiple spaces
  s = s.replace(/\s+/g, ' ');

  // tidy common forms: FAO 27 VII -> FAO27 VII
  const m = s.match(/(?:fa[oô]|FAO)\s*[:\-]?\s*([0-9]{1,3})\s*(.*)$/i);
  if (m) {
    const num = m[1];
    const rest = (m[2] || "").trim().replace(/\s+/g, ' ');
    // lowercase normalized key, keep number and uppercase remainder when displaying
    return (rest ? `fao${num} ${rest.toUpperCase()}` : `fao${num}`).toLowerCase();
  }

  // fallback: lowercase trimmed
  return s.toLowerCase();
}

/** Retourne affichage canonique FAO (FAO27 VII) */
function displayFAO(raw) {
  if (!raw) return "";
  // re-use normalizeFAOKey and reconstruct nice capitalization
  let key = normalizeFAOKey(raw);
  if (!key) return "";
  // key like "fao27 vii" -> "FAO27 VII" or "fao27" -> "FAO27"
  const m = key.match(/^fao(\d+)(?:\s*(.*))?$/);
  if (m) {
    const num = m[1];
    const rest = (m[2] || "").toUpperCase();
    return rest ? `FAO${num} ${rest}` : `FAO${num}`;
  }
  // fallback
  return String(raw).trim().toUpperCase();
}

/** Normalise méthode pêche pour comparaison */
function normalizeMethodKey(raw) {
  if (!raw) return "";
  return String(raw).trim().replace(/\s+/g,' ').toLowerCase();
}

/** Affichage pretty pour méthode pêche (Capitalized) */
function displayMethodPretty(raw) {
  const k = normalizeMethodKey(raw);
  if (!k) return "";
  return k.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * uniqNormalized(values, normalizer, displayer)
 * - values : array of raw strings
 * - normalizer : function(raw) => normalizedKey (string)
 * - displayer  : function(raw) => displayString (optional, fallback raw)
 *
 * Retour : string joined by ", " of unique (by normalizedKey) display values,
 * en conservant la première forme affichable rencontrée.
 */
function uniqNormalized(values = [], normalizer = v => String(v||"").toLowerCase(), displayer = v => (v||"")) {
  const map = new Map(); // normKey -> displayString
  for (const raw of (values || [])) {
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    const key = normalizer(s);
    if (!map.has(key)) {
      const disp = (typeof displayer === "function") ? displayer(s) : s;
      map.set(key, disp);
    }
  }
  return Array.from(map.values()).join(", ");
}

/* ---------------------------------------------------------
   🔥 AGRÉGER TOUTES LES VALEURS MULTIPLES (lots)
   (gardé pour compatibilité si besoin)
--------------------------------------------------------- */
// note: on n'utilise plus uniqValues pour FAO/méthode mais on garde une simple version si besoin
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

    // 🔥 Méthode Prod depuis LOT (plusieurs champs possibles)
    methodesProd.push(
      d.Categorie || d.categorie || d.Elevage || d.methodeProd || d.methode || ""
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
      achatData?.methode ||
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
    artData?.methode ||
    "";


  /* ----------------------
     OBJECT FINAL
  ---------------------- */
  return {
    type: "TRAD",

    criee: hasLots
      ? uniqNormalized(snapLots.docs.map(l => l.data().criee || ""), v => String(v).trim().toLowerCase(), v => v)
      : (achatData?.criee || ""),

    designation:
      // dedupe designations (case-insensitive, keep first form)
      uniqNormalized(designations.length ? designations : [achatData?.designation || artData?.Designation || artData?.designation || ""],
                      v => String(v).trim().toLowerCase(),
                      v => v) || "",

    nomLatin:
      // dedupe noms latins (insensible casse)
      uniqNormalized(nomsLatin.length ? nomsLatin : [achatData?.nomLatin || artData?.NomLatin || artData?.nomLatin || ""],
                      v => String(v).trim().toLowerCase(),
                      v => v) || "",

    fao:
      // dedupe FAO en normalisant les formats (FAO27 VII / FAO 27 VII / fao27 vii -> FAO27 VII)
      uniqNormalized(faos.length ? faos : [achatData?.fao || artData?.Zone || artData?.zone || ""],
                      normalizeFAOKey,
                      displayFAO) || "",

    engin:
      // dedupe engins (canonisés + insensible casse)
      uniqNormalized(engins.length ? engins : [canoniseEngin(achatData?.engin) || canoniseEngin(artData?.Engin) || canoniseEngin(artData?.engin) || ""],
                      v => String(v).trim().toLowerCase(),
                      v => v) || "",

    decongele:
      uniqNormalized(decongeles.length ? decongeles : [(achatData?.decongele ? "Oui" : "Non") || (artData?.decongele ? "Oui" : "Non") || "Non"],
                      v => String(v).trim().toLowerCase(),
                      v => v) || "Non",

    allergenes:
      uniqNormalized(allergenesLots.length ? allergenesLots : [achatData?.Allergenes || achatData?.allergenes || artData?.Allergenes || artData?.allergenes || ""],
                      v => String(v).trim().toLowerCase(),
                      v => v) || "",

    methodeProd:
      // dedupe méthode production (lots first, then achat, then article) with pretty display
      uniqNormalized(methodesProd.length ? methodesProd : [achatMethode || artMethode || ""],
                      normalizeMethodKey,
                      displayMethodPretty) || "",

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
