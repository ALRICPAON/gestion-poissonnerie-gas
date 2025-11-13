/**************************************************
 * IMPORT SOGELMER (10003)
 * Version stable — 14/11/2025
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

    // 🔎 Détection d’un vrai code produit
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

    // 🐟 Nom latin
    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    // 🌍 FAO
    let zone = "";
    let sousZone = "";
    let fao = "";

    const faoMatch = bio.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
    if (faoMatch) {
      zone = `FAO ${faoMatch[1]}`;
      sousZone = faoMatch[2] || "";
      if (/autres ss zones/i.test(bio))
        sousZone += " & AUTRES SS ZONES";
      fao = `${zone} ${sousZone}`.trim();
    }

    // 🎣 Engin
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|FILTS/gi);
    if (engMatch) engin = engMatch[0];

    // 🧽 Normalisation FILMAIL → Filet maillant / FILTS → Filet tournant
    if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
    if (/FILTS/i.test(engin))   engin = "FILET TOURNANT";

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

    i += 11; // On passe au bloc article suivant
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
 * 🔎 Recherche AF_MAP — tolère zéros supprimés
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

  // Crée l'achat
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

    // AF_MAP
    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);
    if (M) {
      plu = (M.plu || "").toString();
      if (M.designationInterne) designationInterne = M.designationInterne;
      if (!L.nomLatin && M.nomLatin) L.nomLatin = M.nomLatin;
      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = M.engin;
      if (!fao) fao = buildFAO(zone, sousZone);
    } else {
      missingRefs.push(L.refFournisseur);
    }

    // Articles
    const art = plu ? artMap[plu] : null;
    if (art) {
      if (art.designation) designationInterne = art.designation;
      if (!zone && art.zone) zone = art.zone;
      if (!sousZone && art.sousZone) sousZone = art.sousZone;
      if (!engin && art.engin) engin = art.engin;
      if (!fao) fao = buildFAO(zone, sousZone);
      if (!L.nomLatin && art.nomLatin) L.nomLatin = art.nomLatin;
    }

    // Écriture Firestore
    await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu,
      designationInterne,
      allergenes,
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg: totalKg,
    updatedAt: serverTimestamp()
  });

  if (missingRefs.length > 0)
    console.warn("⚠️ Références SOGELMER manquantes dans AF_MAP:", missingRefs);

  alert(`✅ ${lines.length} lignes importées pour Sogelmer`);
  location.reload();
}

/**************************************************
 * 🚀 Entrée principale
 **************************************************/
export async function importSogelmer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseSogelmer(text);
  await saveSogelmer(lines);
}
