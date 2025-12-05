import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ExcelJS global (doit être présent sur la page)
const ExcelJS = window.ExcelJS;

/* ===========================================================
   Helpers utilitaires : normalisation, diacritics, Levenshtein
   =========================================================== */

function removeDiacritics(str) {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// compacte une chaîne pour comparaison (lettres uniquement, lower)
function alphaKey(str) {
  return removeDiacritics(String(str || "")).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Levenshtein distance (simple, OK pour petites chaînes)
function levenshtein(a, b) {
  if (a === b) return 0;
  a = a || "";
  b = b || "";
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = Array.from({ length: al + 1 }, () => new Array(bl + 1));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }
  return dp[al][bl];
}

/* ===========================================================
   Canonisation Engin & Méthode / FAO + affichages prettys
   =========================================================== */

function canoniseEngin(v) {
  if (!v) return "";
  const s = String(v).toUpperCase().trim();
  if (s.includes("OTB")) return "Chalut OTB";
  if (s.includes("CHALUT")) return "Chalut OTB";
  if (s.includes("FILET")) return "Filet maillant";
  if (s.includes("LIGNE")) return "Ligne hameçon";
  // fallback : capitaliser proprement
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function normalizeMethodKey(raw) {
  if (!raw) return "";
  return removeDiacritics(String(raw).trim()).toLowerCase().replace(/\s+/g,' ');
}
function displayMethodPretty(raw) {
  if (!raw) return "";
  const k = String(raw).trim().toLowerCase();
  return k.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* -----------------------------
   FAO normalization & display
   ----------------------------- */
// transforme "FAO27 -VII-", "fao 27 vii", "FAO27 VII" -> key "fao27 vii"
function normalizeFAOKey(raw) {
  if (!raw) return "";
  let s = String(raw || "").trim();
  s = s.replace(/\s*-\s*/g, ' ');       // unify hyphens to spaces
  s = s.replace(/\s+/g, ' ');
  // Detect FAO number + remainder
  const m = s.match(/fa[oô]?\s*[:\-]?\s*([0-9]{1,3})\s*(.*)$/i) || s.match(/^([0-9]{1,3})\s*(.*)$/);
  if (m) {
    const num = m[1];
    const rest = (m[2] || "").trim();
    return (`fao${num}` + (rest ? " " + removeDiacritics(rest).toLowerCase().replace(/\s+/g, ' ') : "")).toLowerCase();
  }
  // fallback: strip punctuation and lowercase
  return removeDiacritics(s).toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
}

// Affichage "FAO27 - VII"
function displayFAO(raw) {
  if (!raw) return "";
  // try to parse normalized key
  const key = normalizeFAOKey(raw);
  const m = key.match(/^fao(\d+)(?:\s*(.*))?$/);
  if (m) {
    const num = m[1];
    const rest = (m[2] || "").trim();
    return rest ? `FAO${num} - ${rest.toUpperCase()}` : `FAO${num}`;
  }
  // fallback capitalized
  return String(raw).trim().toUpperCase();
}

/* ===========================================================
   Déduplication intelligente (générique)
   - possibilite de fuzzy regroup (levenshtein <= threshold)
   =========================================================== */

/**
 * dedupeFuzzy(arr, options)
 * - arr : array of raw strings
 * - opts:
 *    normalizer(raw) -> key (for grouping)
 *    display(raw) -> displayString
 *    fuzzyThreshold (integer distance for alphaKey)
 *
 * Retour : array of unique display strings, combined in the order encountered.
 */
function dedupeFuzzy(arr = [], opts = {}) {
  const normalizer = opts.normalizer || (v => String(v||"").trim().toLowerCase());
  const displayFn = opts.display || (v => v);
  const threshold = (typeof opts.fuzzyThreshold === 'number') ? opts.fuzzyThreshold : 1;

  // map normalized -> list of originals
  const buckets = new Map();
  for (const raw of arr || []) {
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    const norm = normalizer(s);
    if (!buckets.has(norm)) buckets.set(norm, []);
    buckets.get(norm).push(s);
  }

  // convert buckets keys to array and attempt to merge near keys
  const keys = Array.from(buckets.keys());
  const merged = []; // array of {key, values}

  const visited = new Set();
  for (let i = 0; i < keys.length; i++) {
    if (visited.has(keys[i])) continue;
    const group = { keys: [keys[i]], values: buckets.get(keys[i])?.slice() || [] };
    visited.add(keys[i]);
    for (let j = i+1; j < keys.length; j++) {
      if (visited.has(keys[j])) continue;
      const dist = levenshtein(alphaKey(keys[i]), alphaKey(keys[j]));
      if (dist <= threshold) {
        // merge j into i
        group.keys.push(keys[j]);
        group.values.push(...(buckets.get(keys[j]) || []));
        visited.add(keys[j]);
      }
    }
    merged.push(group);
  }

  // For each merged group choose the best display variant:
  // pick the most frequent original string (case-sensitive as encountered),
  // fallback pick longest trimmed.
  const results = [];
  for (const g of merged) {
    const counts = new Map();
    for (const v of g.values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    // pick most frequent
    let best = null;
    let bestCount = -1;
    for (const [val, cnt] of counts.entries()) {
      if (cnt > bestCount) { best = val; bestCount = cnt; }
      else if (cnt === bestCount && val.length > (best?.length || 0)) { best = val; }
    }
    // produce final display via displayFn
    results.push(displayFn(best || g.values[0]));
  }

  // preserve order: we return results in the order of first appearance in original arr
  // but merged already preserves that because buckets were created in encounter order.
  return results;
}

/* ===========================================================
   getInfoPLU : récupère et nettoie données (utilise dedupeFuzzy)
   =========================================================== */

async function getInfoPLU(plu) {
  // LOTS
  const snapLots = await getDocs(
    query(collection(db, "lots"), where("plu", "==", plu), where("closed", "==", false))
  );

  const designations = [];
  const nomsLatin = [];
  const faos = [];
  const engins = [];
  const decongeles = [];
  const allergenesLots = [];
  const methodesProd = [];

  snapLots.forEach(l => {
    const d = l.data();
    if (d.designation) designations.push(d.designation);
    if (d.nomLatin) nomsLatin.push(d.nomLatin);
    if (d.fao) faos.push(d.fao);
    if (d.engin) engins.push(canoniseEngin(d.engin));
    decongeles.push(d.decongele ? "Oui" : "Non");
    if (d.allergenes) allergenesLots.push(d.allergenes);
    // methodes
    methodesProd.push(d.Categorie || d.categorie || d.Elevage || d.methodeProd || d.methode || "");
  });

  const hasLots = !snapLots.empty;

  // pv réel
  let pvReal = 0;
  try {
    const snapStockArt = await getDoc(doc(db, "stock_articles", "PLU_" + plu));
    if (snapStockArt.exists()) pvReal = snapStockArt.data().pvTTCreel || 0;
  } catch (e) {
    pvReal = 0;
  }

  // achat fallback
  let achatData = null;
  let achatMethode = "";
  try {
    const snapAchats = await getDocs(query(collection(db, "achats"), where("plu", "==", plu)));
    if (!snapAchats.empty) {
      achatData = snapAchats.docs[0].data();
      achatMethode = achatData?.Categorie || achatData?.categorie || achatData?.Elevage || achatData?.methodeProd || achatData?.methode || "";
    }
  } catch (e) {
    achatData = null;
  }

  // article fallback
  let artData = {};
  try {
    const snapArt = await getDoc(doc(db, "articles", plu));
    if (snapArt.exists()) artData = snapArt.data();
  } catch (e) {
    artData = {};
  }
  const artMethode = artData?.Categorie || artData?.categorie || artData?.Elevage || artData?.methodeProd || artData?.methode || "";

  /* ---- Deduplication & pretty display ---- */
  // Designation : dedupe case-insensitive, keep first forms
  const designationDisplay = dedupeFuzzy(
    designations.length ? designations : [achatData?.designation || artData?.Designation || artData?.designation || ""],
    { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 1 }
  ).join(", ");

  // Nom latin : use alpha-key + fuzzy cluster (levenshtein threshold 1)
  const nlCandidates = nomsLatin.length ? nomsLatin : [achatData?.nomLatin || artData?.NomLatin || artData?.nomLatin || ""];
  // pretty-capitalize (Title case scientific name: keep case like "Clupea harengus")
  function prettyLatin(s) {
    if (!s) return "";
    // try to keep initial capitalization if sensible; else title-case
    s = String(s).trim();
    // If already has lowercase after first letter (like "Clupea harengus"), keep it.
    if (/[A-Z][a-z]/.test(s)) return s;
    // else title-case
    return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  const nls = dedupeFuzzy(nlCandidates, { normalizer: v => alphaKey(v), display: v => prettyLatin(v), fuzzyThreshold: 1 });
  const nomLatinDisplay = nls.join(", ");

  // FAO : use normalizeFAOKey + displayFAO
  const faoCandidates = faos.length ? faos : [achatData?.fao || artData?.Zone || artData?.zone || ""];
  const faoList = dedupeFuzzy(faoCandidates, { normalizer: normalizeFAOKey, display: displayFAO, fuzzyThreshold: 0 });
  const faoDisplay = faoList.join(", ");

  // Engin : canonise and dedupe
  const enginCandidates = engins.length ? engins : [canoniseEngin(achatData?.engin) || canoniseEngin(artData?.Engin) || canoniseEngin(artData?.engin) || ""];
  const enginList = dedupeFuzzy(enginCandidates, { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 0 });
  const enginDisplay = enginList.join(", ");

  // decongele & allergenes (simple dedupe)
  const decongeleDisplay = Array.from(new Set(decongeles)).join(", ");
  const allergenesDisplay = dedupeFuzzy(allergenesLots.length ? allergenesLots : [achatData?.Allergenes || achatData?.allergenes || artData?.Allergenes || artData?.allergenes || ""],
                                       { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 0 }).join(", ");

  // Methode prod : dedupe (fuzzy small threshold 1)
  const methodeCandidates = methodesProd.length ? methodesProd : [achatMethode || artMethode || ""];
  const methodeList = dedupeFuzzy(methodeCandidates, { normalizer: normalizeMethodKey, display: displayMethodPretty, fuzzyThreshold: 1 });
  const methodeDisplay = methodeList.join(", ");

  // Criee : simple dedupe
  const crieeDisplay = dedupeFuzzy(snapLots.docs.map(l => l.data().criee || "").filter(Boolean).length ? snapLots.docs.map(l => l.data().criee || "") : [achatData?.criee || ""],
                                   { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 0 }).join(", ");

  // final object
  return {
    type: "TRAD",
    criee: crieeDisplay,
    designation: designationDisplay || "",
    nomLatin: nomLatinDisplay || "",
    fao: faoDisplay || "",
    engin: enginDisplay || "",
    decongele: decongeleDisplay || "Non",
    allergenes: allergenesDisplay || "",
    methodeProd: methodeDisplay || "",
    prix: pvReal || 0,
    unite: artData?.Unite || "€/kg"
  };
}

/* ===========================================================
   Export XLSX
   =========================================================== */

export async function exportEtiquettes() {
  console.log("⏳ Export étiquettes…");

  const snapLots = await getDocs(
    query(collection(db, "lots"), where("closed", "==", false))
  );

  const PLUs = new Set();
  snapLots.forEach(l => {
    const d = l.data();
    if ((d.poidsRestant || 0) > 0) PLUs.add(d.plu);
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
      info.decongele === "Oui" ? "Oui" : "",   // mettre Oui si décongelé
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
