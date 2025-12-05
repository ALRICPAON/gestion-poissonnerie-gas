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

function alphaKey(str) {
  return removeDiacritics(String(str || "")).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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
   Normalisations spécifiques (Engin, FAO, Méthode)
   =========================================================== */

function canoniseEngin(v) {
  if (!v) return "";
  const s = String(v).toUpperCase().trim();
  if (s.includes("OTB")) return "Chalut OTB";
  if (s.includes("CHALUT")) return "Chalut OTB";
  if (s.includes("FILET")) return "Filet maillant";
  if (s.includes("LIGNE")) return "Ligne hameçon";
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

/* FAO normalization & pretty display */
function normalizeFAOKey(raw) {
  if (!raw) return "";
  let s = String(raw || "").trim();
  s = s.replace(/\s*-\s*/g, ' ');
  s = s.replace(/\s+/g, ' ');
  const m = s.match(/fa[oô]?\s*[:\-]?\s*([0-9]{1,3})\s*(.*)$/i) || s.match(/^([0-9]{1,3})\s*(.*)$/);
  if (m) {
    const num = m[1];
    const rest = (m[2] || "").trim();
    return (`fao${num}` + (rest ? " " + removeDiacritics(rest).toLowerCase().replace(/\s+/g, ' ') : "")).toLowerCase();
  }
  return removeDiacritics(s).toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
}
function displayFAO(raw) {
  if (!raw) return "";
  const key = normalizeFAOKey(raw);
  const m = key.match(/^fao(\d+)(?:\s*(.*))?$/);
  if (m) {
    const num = m[1];
    const rest = (m[2] || "").trim();
    return rest ? `FAO${num} - ${rest.toUpperCase()}` : `FAO${num}`;
  }
  return String(raw).trim().toUpperCase();
}

/* ===========================================================
   splitMulti: découpe une chaîne qui contient plusieurs valeurs
   (séparateurs: , / ; | ) et nettoie les tirets & espaces
   =========================================================== */
function splitMulti(raw) {
  if (!raw && raw !== 0) return [];
  const s = String(raw).trim();
  if (!s) return [];
  // Replace common ' - ' sequences by a single space where appropriate but keep FAO handled separately
  // We split on , / ; | and also " / " with optional spaces
  const parts = s.split(/[\/,;|]+/).map(p => p.trim()).filter(Boolean);
  // additionally, for tokens that include repeated inner punctuation (like "FAO27 -VII-" keep as is),
  // we trim stray hyphens/spaces at ends
  return parts.map(p => p.replace(/^[\s\-\–\—\:]+|[\s\-\–\—\:]+$/g,'').trim()).filter(Boolean);
}

/* ===========================================================
   dedupeFuzzy: regroupe variants (fuzzy) et renvoie affichage
   =========================================================== */
function dedupeFuzzy(arr = [], opts = {}) {
  const normalizer = opts.normalizer || (v => String(v||"").trim().toLowerCase());
  const displayFn = opts.display || (v => v);
  const threshold = (typeof opts.fuzzyThreshold === 'number') ? opts.fuzzyThreshold : 1;

  // build frequency map of normalized tokens
  const tokens = [];
  for (const raw of arr || []) {
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    tokens.push(s);
  }
  if (!tokens.length) return [];

  // bucket by normalized key
  const buckets = new Map();
  for (const t of tokens) {
    const k = normalizer(t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }

  // attempt to merge near keys
  const keys = Array.from(buckets.keys());
  const merged = [];
  const visited = new Set();
  for (let i=0;i<keys.length;i++) {
    if (visited.has(keys[i])) continue;
    const group = { keys: [keys[i]], values: buckets.get(keys[i]).slice() };
    visited.add(keys[i]);
    for (let j=i+1;j<keys.length;j++) {
      if (visited.has(keys[j])) continue;
      const dist = levenshtein(alphaKey(keys[i]), alphaKey(keys[j]));
      if (dist <= threshold) {
        group.keys.push(keys[j]);
        group.values.push(...(buckets.get(keys[j])||[]));
        visited.add(keys[j]);
      }
    }
    merged.push(group);
  }

  // pick best display for each merged group (most frequent or longest)
  const results = [];
  for (const g of merged) {
    const counts = new Map();
    for (const v of g.values) counts.set(v, (counts.get(v)||0)+1);
    let best = null; let bestCount = -1;
    for (const [val,cnt] of counts.entries()) {
      if (cnt > bestCount) { best = val; bestCount = cnt; }
      else if (cnt === bestCount && val.length > (best?.length || 0)) { best = val; }
    }
    results.push(displayFn(best || g.values[0]));
  }

  return results;
}

/* ===========================================================
   getInfoPLU : récupère et nettoie données (split + dedupe)
   =========================================================== */

async function getInfoPLU(plu) {
  // lots ouverts
  const snapLots = await getDocs(
    query(collection(db, "lots"), where("plu", "==", plu), where("closed", "==", false))
  );

  // collect tokens (split multi-values)
  const designationsTokens = [];
  const nomsLatinTokens = [];
  const faoTokens = [];
  const enginTokens = [];
  const decongeles = [];
  const allergenesTokens = [];
  const methodesTokens = [];
  const crieeTokens = [];

  snapLots.forEach(l => {
    const d = l.data();
    if (d.designation) splitMulti(d.designation).forEach(x => designationsTokens.push(x));
    if (d.nomLatin) splitMulti(d.nomLatin).forEach(x => nomsLatinTokens.push(x));
    if (d.fao) splitMulti(d.fao).forEach(x => faoTokens.push(x));
    if (d.engin) splitMulti(canoniseEngin(d.engin)).forEach(x => enginTokens.push(x));
    decongeles.push(d.decongele ? "Oui" : "Non");
    if (d.allergenes) splitMulti(d.allergenes).forEach(x => allergenesTokens.push(x));
    // méthodes
    const m = d.Categorie || d.categorie || d.Elevage || d.methodeProd || d.methode || "";
    if (m) splitMulti(m).forEach(x => methodesTokens.push(x));
    if (d.criee) splitMulti(d.criee).forEach(x => crieeTokens.push(x));
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

  // achats fallback
  let achatData = null;
  let achatMethode = "";
  try {
    const snapAchats = await getDocs(query(collection(db, "achats"), where("plu", "==", plu)));
    if (!snapAchats.empty) {
      achatData = snapAchats.docs[0].data();
      const am = achatData?.Categorie || achatData?.categorie || achatData?.Elevage || achatData?.methodeProd || achatData?.methode || "";
      if (am) splitMulti(am).forEach(x => methodesTokens.push(x));
      if (achatData?.criee) splitMulti(achatData.criee).forEach(x => crieeTokens.push(x));
      if (achatData?.Allergenes || achatData?.allergenes) splitMulti(achatData.Allergenes || achatData.allergenes).forEach(x => allergenesTokens.push(x));
    }
  } catch(e) {
    achatData = null;
  }

  // article fallback
  let artData = {};
  try {
    const snapArt = await getDoc(doc(db, "articles", plu));
    if (snapArt.exists()) artData = snapArt.data();
  } catch(e) {
    artData = {};
  }
  const artMethode = artData?.Categorie || artData?.categorie || artData?.Elevage || artData?.methodeProd || artData?.methode || "";
  if (artMethode) splitMulti(artMethode).forEach(x => methodesTokens.push(x));
  if (artData?.Zone) splitMulti(artData.Zone).forEach(x => faoTokens.push(x));
  if (artData?.Engin || artData?.engin) splitMulti(canoniseEngin(artData.Engin || artData.engin)).forEach(x => enginTokens.push(x));
  if (artData?.NomLatin || artData?.nomLatin) splitMulti(artData.NomLatin || artData.nomLatin).forEach(x => nomsLatinTokens.push(x));
  if (artData?.Designation || artData?.designation) splitMulti(artData.Designation || artData.designation).forEach(x => designationsTokens.push(x));

  // If tokens empty, fallback to single fields
  if (!designationsTokens.length) {
    const fallback = achatData?.designation || artData?.Designation || artData?.designation || "";
    if (fallback) splitMulti(fallback).forEach(x => designationsTokens.push(x));
  }
  if (!nomsLatinTokens.length) {
    const fallback = achatData?.nomLatin || artData?.NomLatin || artData?.nomLatin || "";
    if (fallback) splitMulti(fallback).forEach(x => nomsLatinTokens.push(x));
  }
  if (!faoTokens.length) {
    const fallback = achatData?.fao || artData?.Zone || artData?.zone || "";
    if (fallback) splitMulti(fallback).forEach(x => faoTokens.push(x));
  }
  if (!enginTokens.length) {
    const fallback = achatData?.engin || artData?.Engin || artData?.engin || "";
    if (fallback) splitMulti(canoniseEngin(fallback)).forEach(x => enginTokens.push(x));
  }
  if (!methodesTokens.length && (achatData || artData)) {
    const fallback = achatData?.Categorie || achatData?.categorie || artData?.Categorie || artData?.categorie || "";
    if (fallback) splitMulti(fallback).forEach(x => methodesTokens.push(x));
  }

  // dedupe & pretty
  const designationDisplay = dedupeFuzzy(designationsTokens, { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 1 }).join(", ");
  function prettyLatin(s) {
    if (!s) return "";
    s = String(s).trim();
    if (/[A-Z][a-z]/.test(s)) return s;
    return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  const nomLatinDisplay = dedupeFuzzy(nomsLatinTokens, { normalizer: v => alphaKey(v), display: v => prettyLatin(v), fuzzyThreshold: 1 }).join(", ");
  const faoDisplay = dedupeFuzzy(faoTokens, { normalizer: normalizeFAOKey, display: displayFAO, fuzzyThreshold: 0 }).join(", ");
  const enginDisplay = dedupeFuzzy(enginTokens, { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 0 }).join(", ");
  const decongeleDisplay = Array.from(new Set(decongeles)).join(", ");
  const allergenesDisplay = dedupeFuzzy(allergenesTokens, { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 0 }).join(", ");
  const methodeDisplay = dedupeFuzzy(methodesTokens, { normalizer: normalizeMethodKey, display: displayMethodPretty, fuzzyThreshold: 1 }).join(", ");
  const crieeDisplay = dedupeFuzzy(crieeTokens, { normalizer: v => String(v).trim().toLowerCase(), display: v => String(v).trim(), fuzzyThreshold: 0 }).join(", ");

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
      info.decongele === "Oui" ? "Oui" : "",
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
