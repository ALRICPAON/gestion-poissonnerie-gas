/**************************************************
 * IMPORT SOGELMER (10003)
 * Version FINALISÉE — 14/11/2025
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { manageAFMap } from "./manage-af-map.js";


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

  return text;
}

/**************************************************
 * Code article SOGELMER
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|SOGELMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE/i.test(s);

/**************************************************
 * PARSE PDF → blocs Sogelmer
 **************************************************/
export function parseSogelmer(text) {

  const rows = [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!isArticleCode(line)) {
      i++;
      continue;
    }

    const ref = line;
    const designation = (lines[i + 1] || "").trim();
    const colis        = parseFloat((lines[i + 2] || "").replace(",", "."));
    const poidsColisKg = parseFloat((lines[i + 3] || "").replace(",", "."));
    const quantite     = parseFloat((lines[i + 4] || "").replace(",", "."));
    const uv           = (lines[i + 5] || "").trim();
    const lot          = (lines[i + 6] || "").trim();

    let prixKg = 0;
    if ((lines[i + 7] || "").includes("€"))
      prixKg = parseFloat(lines[i + 7].replace("€", "").replace(",", "."));

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€", "").replace(",", "."));

    const bio = (lines[i + 10] || "").trim();

    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    let zone = "";
    let sousZone = "";
    let fao = "";
    const faoMatch = bio.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
    if (faoMatch) {
      zone = `FAO ${faoMatch[1]}`;
      sousZone = faoMatch[2] || "";
      fao = `${zone} ${sousZone}`.trim();
    }

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

  return rows;
}

/**************************************************
 * AF_MAP strict
 **************************************************/
function findAFMapEntry(afMap, fourCode, refF) {
  const clean = refF.toString().trim();
  const keyExact  = `${fourCode}__${clean}`.toUpperCase();
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/, "")}`.toUpperCase();
  return afMap[keyExact] || afMap[keyNoZero] || null;
}

/**************************************************
 * FAO builder
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  return `${zone} ${sousZone || ""}`.trim();
}

/**************************************************
 * SAVE SOGELMER
 **************************************************/
async function saveSogelmer(lines) {

  const FOUR_CODE = "10003";
  if (!lines.length) throw new Error("Aucune ligne SOGELMER détectée");

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => afMap[d.id.toUpperCase()] = d.data());

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a.plu) artMap[a.plu.toString()] = a;
  });

  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0,10),
    fournisseurCode: FOUR_CODE,
    fournisseurNom: "SOGELMER",
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
  let missingRefs = [];

  /**************************************************
   * BOUCLE DES LIGNES
   **************************************************/
  for (const L of lines) {

    totalHT += Number(L.montantHT || 0);
    totalKg += Number(L.poidsTotalKg || 0);

    /**************************************************
     * 🧩 ENRICHISSEMENT AF_MAP + ARTICLES
     **************************************************/
    let plu = "";
    let designationInterne = (L.designation || "").trim();
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;

    let cleanFromAF = "";

    // ---- AF_MAP = priorité totale
    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    if (M) {
      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");

      cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();
      if (cleanFromAF) {
        L.designation = cleanFromAF;
        designationInterne = cleanFromAF;
      }

      if ((!L.nomLatin || /total/i.test(L.nomLatin)) && M.nomLatin)
        L.nomLatin = M.nomLatin;

      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = M.engin;

      if (!fao) fao = buildFAO(zone, sousZone);

    } else {
      missingRefs.push(
  L.refFournisseur.replace(/\//g, "_")
);

    }

    // ---- ARTICLES fallback
    const art = plu ? artMap[plu] : null;

    if (art) {

      if (!cleanFromAF) {
        const artDesignation = (art.Designation || art.designation || "").trim();
        if (artDesignation) {
          L.designation = artDesignation;
          designationInterne = artDesignation;
        }
      }

      if (!L.nomLatin)
        L.nomLatin = (art.NomLatin || art.nomLatin || "").trim();

      if (!zone && (art.Zone || art.zone)) zone = art.Zone || art.zone;
      if (!sousZone && (art.SousZone || art.sousZone)) sousZone = art.SousZone || art.sousZone;
      if (!engin && (art.Engin || art.engin)) engin = art.Engin || art.engin;

      if (!fao) fao = buildFAO(zone, sousZone);
    }

    // Normalisation engins
    if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
    if (/FILTS/i.test(engin))   engin = "FILET TOURNANT";

    /**************************************************
     * Sauvegarde Firestore de la ligne
     **************************************************/
    await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu,
      designationInterne,
      allergenes,
      fournisseurRef: L.refFournisseur,
      zone,
      sousZone,
      engin,
      fao,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  } // ← fermeture du for

  /**************************************************
   * Mise à jour du total
   **************************************************/
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  if (missingRefs.length > 0)
    console.warn("⚠️ Références SOGELMER non trouvées dans AF_MAP:", missingRefs);

    // Après updateDoc(...)
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  // 🆕🔔 OUVERTURE POPUP MANAGE AF_MAP SI RÉF MANQUANTE
  if (missingRefs.length > 0) {
    console.log("🔎 Références SOGELMER manquantes :", missingRefs);
    await manageAFMap(
      missingRefs.map(ref => ({
        fournisseurCode: FOUR_CODE,
        refFournisseur: ref,
        designation: "",   // tu peux mettre L.designation si tu veux
        achatId: achatId
      }))
    );
  }

  alert(`✅ ${lines.length} lignes importées pour SOGELMER`);
  location.reload();


  alert(`✅ ${lines.length} lignes importées pour SOGELMER`);
  location.reload();
}

/**************************************************
 * MAIN
 **************************************************/
export async function importSogelmer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseSogelmer(text);
  await saveSogelmer(lines);
}
