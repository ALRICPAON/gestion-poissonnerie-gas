/**************************************************
 * IMPORT SOGELMER (10003)
 * Version finale, propre & patchée
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * PDF → texte
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
 * Détection code article
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|SOGELMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE/i.test(s);

/**************************************************
 * Normalisation des références SOGELMER
 * EMISP/6 → EMISP_06
 * RAI121F/6 → RAI121F_06
 * (idempotent : si déjà EMISP_06, ne bouge plus)
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");

  // On ne pad que si on a "LETTRES+1 chiffre" (ex: EMISP_6)
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");

  return r.toUpperCase();
}

/**************************************************
 * Parse PDF → lignes SOGELMER
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

    const rawRef = line;
    const refFournisseur = normalizeRef(rawRef);

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
    if (/FILTS/i.test(engin))   engin = "FILET TOURNANT";

    rows.push({
      refFournisseur,        // déjà normalisé (EMISP_06)
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
 * AF_MAP smart matching
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {

  const clean = (ref || "").toString().trim().toUpperCase();

  // EXACT
  const keyExact = `${fourCode}__${clean}`;

  // SANS ZERO (au cas où)
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/, "")}`;

  // AVEC ZERO AUTO (si jamais ref mal stockée dans AF_MAP)
  const keyPadded = `${fourCode}__${clean.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2")}`;

  return (
    afMap[keyExact] ||
    afMap[keyNoZero] ||
    afMap[keyPadded] ||
    null
  );
}

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

  const missingRefs = [];

  for (const L of lines) {

    totalHT += Number(L.montantHT || 0);
    totalKg += Number(L.poidsTotalKg || 0);

    // Préparation
    let plu = "";
    let designationInterne = (L.designation || "").trim();
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;

    let cleanFromAF = "";

    /**************************************************
     * AF_MAP — priorité totale
     **************************************************/
    // L.refFournisseur est déjà normalisé dans parseSogelmer
    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    if (M) {

      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");

      cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();
      if (cleanFromAF) {
        L.designation = cleanFromAF;
        designationInterne = cleanFromAF;
      }

      if ((!L.nomLatin || /total/i.test(L.nomLatin)) && M.nomLatin) {
        L.nomLatin = M.nomLatin;
      }

      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = M.engin;

      if (!fao) fao = buildFAO(zone, sousZone);
    }

    /**************************************************
     * Articles (fallback)
     **************************************************/
    if (plu && artMap[plu]) {

      const art = artMap[plu];

      const artDesignation =
        (art.Designation || art.designation || art.designationInterne || "").trim();

      // Si AF_MAP n’a pas donné de nom → on prend celui de la fiche article
      if (!cleanFromAF && artDesignation) {
        L.designation = artDesignation;
        designationInterne = artDesignation;
      }

      if (!zone && (art.Zone || art.zone)) {
        zone = art.Zone || art.zone;
      }

      if (!sousZone && (art.SousZone || art.sousZone)) {
        sousZone = art.SousZone || art.sousZone;
      }

      if (!engin && (art.Engin || art.engin)) {
        engin = art.Engin || art.engin;
      }

      if (!fao) {
        fao = buildFAO(zone, sousZone);
      }
    }

    /**************************************************
     * SAVE LIGNE
     **************************************************/
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      fournisseurRef: L.refFournisseur,

      plu,
      designation: L.designation,
      designationInterne,
      nomLatin: L.nomLatin,

      zone,
      sousZone,
      fao,
      engin,
      allergenes,

      poidsKg: L.poidsTotalKg,
      prixHTKg: L.prixKg,
      prixKg: L.prixKg,
      montantHT: L.montantHT,
      montantTTC: L.montantHT,

      colis: L.colis,
      poidsColisKg: L.poidsColisKg,
      poidsTotalKg: L.poidsTotalKg,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const lineId = lineRef.id;

    /**************************************************
     * MANQUANTS → popup AF_MAP
     * (⚠️ clé = **ligneId** pour coller à manage-af-map.js)
     **************************************************/
    if (!M) {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,   // déjà normalisé (EMISP_06)
        designation: L.designation || "",
        designationInterne: designationInterne || "",
        aliasFournisseur: L.designation || "",
        nomLatin: L.nomLatin || "",
        zone: zone || "",
        sousZone: sousZone || "",
        engin: engin || "",
        allergenes: allergenes || "",
        achatId,
        ligneId: lineId                     // 🔴 ICI : **ligneId** (et pas lineId)
      });
    }
  }

  // Update achat
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  // Show popup if needed
  if (missingRefs.length > 0) {
    console.warn("🔎 Réf SOGELMER manquantes :", missingRefs);
    const mod = await import("./manage-af-map.js");
    mod.manageAFMap(missingRefs);
  }
}

/**************************************************
 * ENTRY
 **************************************************/
export async function importSogelmer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseSogelmer(text);
  await saveSogelmer(lines);
}
