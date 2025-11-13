/**************************************************
 * IMPORT SOGELMER (10003)
 * Version stable — corrigée 14/11/2025
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * PDF TEXT EXTRACT
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) throw new Error("PDF.js non chargé");

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join("\n") + "\n";
  }

  console.log("🔍 PDF SOGELMER brut:", text.slice(0, 1000));
  return text;
}

/**************************************************
 * 🚨 Regex STRICTES : vrai code article uniquement
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|SOGELMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE/i.test(s);

/**************************************************
 * PARSE PRINCIPAL : EXTRACTION DES ARTICLES
 **************************************************/
export function parseSogelmer(text) {

  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let i = 0;

  while (i < lines.length) {
    const L = lines[i];

    if (!isArticleCode(L)) {
      i++;
      continue;
    }

    const ref = L;
    const designation = (lines[i + 1] || "").trim();

    const colis          = parseFloat((lines[i + 2] || "").replace(",", "."));
    const poidsColisKg   = parseFloat((lines[i + 3] || "").replace(",", "."));
    const quantite       = parseFloat((lines[i + 4] || "").replace(",", "."));
    const uv             = (lines[i + 5] || "").trim();
    const lot            = (lines[i + 6] || "").trim();

    let prixKg = 0;
    if ((lines[i + 7] || "").includes("€"))
      prixKg = parseFloat(lines[i + 7].replace("€", "").replace(",", "."));

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€", "").replace(",", "."));

    const bio = (lines[i + 10] || "").trim();

    // Nom latin
    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    // FAO
    let zone = "";
    let sousZone = "";
    let fao = "";

    const faoMatch = bio.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
    if (faoMatch) {
      zone = `FAO ${faoMatch[1]}`;
      sousZone = faoMatch[2] || "";
      if (/autres ss zones/i.test(bio)) sousZone += " & AUTRES SS ZONES";
      fao = `${zone} ${sousZone}`.trim();
    }

    // Engin
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|FILTS/gi);
    if (engMatch) engin = engMatch[0];

    if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
    if (/FILTS/i.test(engin))    engin = "FILET TOURNANT";

    rows.push({
      refFournisseur: ref,
      designation,
      colis,
      poidsColisKg,
      poidsTotalKg: quantite,
      prixKg,
      montantHT,
      uv,
      lot,
      nomLatin,
      zone,
      sousZone,
      engin,
      fao
    });

    i += 11;
  }

  console.log("📦 Lignes SOGELMER extraites:", rows);
  return rows;
}

/**************************************************
 * FAO builder fallback
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  return `${zone} ${sousZone || ""}`.trim();
}

/**************************************************
 * AF_MAP lookup (zéros supprimés)
 **************************************************/
function findAFMapEntry(afMap, fourCode, refF) {
  const clean = refF.toString().trim();
  const key = `${fourCode}__${clean}`.toUpperCase();
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/, "")}`.toUpperCase();
  return afMap[key] || afMap[keyNoZero] || null;
}

/**************************************************
 * SAUVEGARDE FIRESTORE
 **************************************************/
async function saveSogelmer(lines) {

  if (!lines.length) throw new Error("Aucune ligne détectée dans le BL Sogelmer");

  const FOUR_CODE = "10003";
  const supplier = { code: FOUR_CODE, nom: "SOGELMER" };

  // Charge AF_MAP + Articles
  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => afMap[d.id.toUpperCase()] = d.data());

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString()] = a;
  });

  // Crée achat
  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0,10),
    fournisseurCode: supplier.code,
    fournisseurNom: supplier.nom,
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const achatId = achatRef.id;
  let totalHT = 0;
  let totalKg = 0;
  const missingRefs = [];

  for (const L of lines) {

    totalHT += Number(L.montantHT || 0);
    totalKg += Number(L.poidsTotalKg || 0);

    /**************************************************
 * 🧩 Enrichissement AF_MAP + Articles (version Royale Marée adaptée)
 **************************************************/
let plu = "";
let designationInterne = (L.designation || "").trim();
let allergenes = "";
let zone = L.zone;
let sousZone = L.sousZone;
let engin = L.engin;
let fao = L.fao;

let cleanFromAF = "";

// 1) AF_MAP : priorité absolue
const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

if (M) {

  // PLU propre (supprime .0)
  plu = (M.plu || "").toString().trim().replace(/\.0$/, "");

  // Désignation interne (ou aliasFournisseur)
  cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();
  if (cleanFromAF) {
    L.designation = cleanFromAF;
    designationInterne = cleanFromAF;
  }

  // Nom latin si BL vide ou bruité
  if ((!L.nomLatin || /total/i.test(L.nomLatin)) && M.nomLatin) {
    L.nomLatin = M.nomLatin;
  }

  // Traca : AF_MAP > BL
  if (!zone && M.zone) zone = M.zone;
  if (!sousZone && M.sousZone) sousZone = M.sousZone;
  if (!engin && M.engin) engin = M.engin;

  if (!fao) fao = buildFAO(zone, sousZone);

} else {
  missingRefs.push(L.refFournisseur);
}


// 2) ARTICLES : priorité si AF_MAP n’a pas donné de désignation
const art = plu ? artMap[plu] : null;

if (art) {

  if (!cleanFromAF) {
    const artDesignation = (art.Designation || art.designation || "").trim();
    if (artDesignation) {
      L.designation = artDesignation;
      designationInterne = artDesignation;
    }
  }

  if (!L.nomLatin || /total/i.test(L.nomLatin)) {
    L.nomLatin = (art.NomLatin || art.nomLatin || L.nomLatin).trim();
  }

  if (!zone && (art.Zone || art.zone)) zone = (art.Zone || art.zone);
  if (!sousZone && (art.SousZone || art.sousZone)) sousZone = (art.SousZone || art.sousZone);
  if (!engin && (art.Engin || art.engin)) engin = (art.Engin || art.engin);

  if (!fao) fao = buildFAO(zone, sousZone);
}


// Normalisation engin
if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
if (/FILTS/i.test(engin))   engin = "FILET TOURNANT";

/**************************************************
 * 🚀 Entrée principale
 **************************************************/
export async function importSogelmer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseSogelmer(text);
  await saveSogelmer(lines);
}
