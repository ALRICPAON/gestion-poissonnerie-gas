/**************************************************
 * IMPORT SOGELMER (10003)
 * Version 14/11/2025 – Alric x Robert
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * PDF → texte brut
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) throw new Error("PDF.js non chargé");

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let txt = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    txt += content.items.map(i => i.str).join("\n") + "\n";
  }

  console.log("🔍 PDF SOGELMER brut:", txt.slice(0, 1000));
  return txt;
}

/**************************************************
 * PARSER SOGELMER
 **************************************************/
function parseSogelmer(text) {
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0);

  const rows = [];

  // Filtre pour ignorer l'entête
  const ignorePatterns = [
    /^bon de livraison/i,
    /^date/i,
    /^fournisseur/i,
    /^rue/i,
    /^siret/i,
    /^tva/i,
    /^code client/i,
    /^livraison/i,
    /^facture/i
  ];

  function shouldIgnore(l) {
    return ignorePatterns.some(r => r.test(l.toLowerCase()));
  }

  for (let i = 0; i < lines.length; i++) {

    const l = lines[i];

    if (shouldIgnore(l)) continue;

    /**************************************************
     * 1) Ligne 1 = produit
     **************************************************/
    const m = l.match(
      /^([A-Za-z0-9]+)\s+(.+?)\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+KG\s+([A-Za-z0-9]+)\s+([\d,]+)\s+€\s+([\d,]+)\s+€/i
    );

    if (!m) continue;

    const refFournisseur = m[1];
    const designation = m[2].replace(/ean13:.*/i, "").trim();
    const colis = parseInt(m[3], 10);
    const poidsU = parseFloat(m[4].replace(",", "."));
    const poidsTotal = parseFloat(m[5].replace(",", "."));
    const lot = m[6];
    const prixKg = parseFloat(m[7].replace(",", "."));
    const montantHT = parseFloat(m[8].replace(",", "."));

    /**************************************************
     * 2) Ligne 2 = traca (latin + FAO + engin)
     **************************************************/
    const l2 = lines[i + 1] || "";
    const l2norm = l2.toLowerCase();

    let nomLatin = "";
    let fao = "";
    let zone = "";
    let sousZone = "";
    let engin = "";

    // nom latin = premiers mots (ex: "Molva molva - FAO 27 VI...")
    const latinMatch = l2.match(/^([A-Z][a-z]+(?:\s+[a-z]+)?)/i);
    if (latinMatch) nomLatin = latinMatch[1].trim();

    // FAO + sous-zone (on garde " & autres ss zones")
    const faoMatch = l2.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
    if (faoMatch) {
      zone = `FAO ${faoMatch[1]}`;
      sousZone = faoMatch[2] || "";
      if (/autres/i.test(l2norm)) sousZone += " & autres ss zones";
      fao = `${zone} ${sousZone}`.trim();
    }

    // Engin
    const engMatch = l2.match(/Chalut|Filet|Fillet|Cerclage|Traine|Maillant|Tournant|Senne|Palangre/i);
    if (engMatch) engin = engMatch[0].toUpperCase();

    // Mise en forme
    if (engin === "FILMAIL") engin = "FILET MAILLANT";
    if (engin === "FILTS") engin = "FILET TOURNANT";

    rows.push({
      refFournisseur,
      designation,
      nomLatin,
      colis,
      poidsColisKg: poidsU,
      poidsTotalKg: poidsTotal,
      prixKg,
      montantHT,
      lot,
      zone,
      sousZone,
      fao,
      engin
    });
  }

  console.log("📦 Lignes SOGELMER extraites:", rows);
  return rows;
}

/**************************************************
 * AF_MAP + Articles → compléter infos
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {
  const key = `${fourCode}__${ref}`.toUpperCase();
  const noZero = `${fourCode}__${ref.replace(/^0+/, "")}`.toUpperCase();
  return afMap[key] || afMap[noZero] || null;
}

/**************************************************
 * SAUVEGARDE FIRESTORE
 **************************************************/
async function saveSogelmer(lines) {
  const FOUR_CODE = "10003";

  if (!lines.length) throw new Error("Aucune ligne détectée dans le BL Sogelmer");

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => (afMap[d.id.toUpperCase()] = d.data()));

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString()] = a;
  });

  // Créer l'entête achat
  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: FOUR_CODE,
    fournisseurNom: "SOGELMER",
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  let achatId = achatRef.id;

  let totHT = 0;
  let totKg = 0;

  for (const L of lines) {
    totHT += L.montantHT;
    totKg += L.poidsTotalKg;

    // Mapping AF_MAP
    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);
    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";

    if (M) {
      plu = (M.plu || "").toString().trim();
      designationInterne = (M.designationInterne || designationInterne).trim();
      allergenes = M.allergenes || "";
      if (!L.nomLatin && M.nomLatin) L.nomLatin = M.nomLatin;
      if (!L.zone && M.zone) L.zone = M.zone;
      if (!L.sousZone && M.sousZone) L.sousZone = M.sousZone;
      if (!L.engin && M.engin) L.engin = M.engin;
      if (!L.fao && M.zone) L.fao = `FAO ${M.zone}`;
    }

    // Articles en fallback
    const art = plu ? artMap[plu] : null;
    if (art) {
      if (!designationInterne) designationInterne = art.designation;
      if (!L.nomLatin) L.nomLatin = art.nomLatin || "";
      if (!L.zone) L.zone = art.zone || "";
      if (!L.sousZone) L.sousZone = art.sousZone || "";
      if (!L.engin) L.engin = art.engin || "";
    }

    // Enregistrement ligne
    await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu,
      designationInterne,
      allergenes,
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: Number(totHT.toFixed(2)),
    montantTTC: Number(totHT.toFixed(2)),
    totalKg: Number(totKg.toFixed(3)),
    updatedAt: serverTimestamp(),
  });
}

/**************************************************
 * EXPORT POUR ACHATS.HTML
 **************************************************/
export async function importSogelmer(file) {
  const txt = await extractTextFromPdf(file);
  const lines = parseSogelmer(txt);
  await saveSogelmer(lines);
  alert(`✅ Import SOGELMER terminé (${lines.length} lignes)`);
  location.reload();
}
