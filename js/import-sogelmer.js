/**************************************************
 * IMPORT SOGELMER (10003)
 * Version finale — Multi FAO + Multi Latin + Popup AF_MAP
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp,
  updateDoc, getDocs, getDoc
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
 * Détection code article SOGELMER
 **************************************************/
const isArticleCode = s =>
  /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
  !/CLIENT|SOGELMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE/i.test(s);

/**************************************************
 * Normalisation ref fournisseur
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");
  return r.toUpperCase();
}

/**************************************************
 * Multi-FAO (lettres, multiples, évite "Ouest")
 **************************************************/
function extractFAOs(bio) {
  if (!bio) return [];

  const out = [];
  const regex = /FAO\s*([0-9]{1,3})\s*([IVX]{1,4})?\s*([A-Za-z])?/gi;

  let m;
  while ((m = regex.exec(bio)) !== null) {
    const num = m[1];
    const roman = m[2] ? m[2].toUpperCase() : "";
    let letter = m[3] ? m[3].toUpperCase() : "";

    if (letter === "O") letter = ""; // exclure Ouest / Ecosse

    out.push(`FAO ${num} ${roman}${letter}`.trim());
  }

  return [...new Set(out)];
}

/**************************************************
 * Parse SOGELMER
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

    const refFournisseur = normalizeRef(line);

    const designation = (lines[i + 1] || "").trim();
    const colis        = parseFloat((lines[i + 2] || "").replace(",", "."));
    const poidsColisKg = parseFloat((lines[i + 3] || "").replace(",", "."));
    const quantite     = parseFloat((lines[i + 4] || "").replace(",", "."));
    const uv           = (lines[i + 5] || "").trim();
    const lot          = (lines[i + 6] || "").trim();

    let prixKg = 0;
    if ((lines[i + 7] || "").includes("€"))
      prixKg = parseFloat(lines[i + 7].replace("€","").replace(",","."));    

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€","").replace(",","."));    

    const bio = (lines[i + 10] || "").trim();

    /***********************************************
     * NOM LATIN — tout avant " - FAO"
     ***********************************************/
    let multiLatin = [];
    const latinPart = bio.split(/ - FAO| - ANE FAO/i)[0];

    if (latinPart) {
      multiLatin = latinPart
        .split("-")
        .map(x => x.trim())
        .filter(x => x.length > 0);
    }

    const nomLatin = multiLatin.join(" / ");

    /***********************************************
     * MULTI-FAO
     ***********************************************/
    const faoList = extractFAOs(bio);
    const fao = faoList[0] || "";
    const autresFAO = faoList.slice(1);

    /***********************************************
     * ZONES (seulement si 1 FAO)
     ***********************************************/
    let zone = "";
    let sousZone = "";

    if (fao) {
      const parts = fao.split(" ");
      zone = (parts[0] + " " + parts[1]) || "";
      sousZone = parts[2] || "";
    }

    /***********************************************
     * ENGIN (dernier match)
     ***********************************************/
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|Casier|FILTS/gi);
    if (engMatch) engin = engMatch[engMatch.length - 1];

    if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
    if (/FILTS/i.test(engin))   engin = "FILET TOURNANT";

    rows.push({
      refFournisseur,
      designation,
      colis,
      poidsColisKg,
      poidsTotalKg: quantite,
      prixKg,
      montantHT,
      uv,
      lot,

      nomLatin,
      multiLatin,

      fao,
      autresFAO,

      zone,
      sousZone,
      engin
    });

    i += 11;
  }

  return rows;
}

/**************************************************
 * AF_MAP smart match
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {

  const clean = (ref || "").trim().toUpperCase();

  const keyExact  = `${fourCode}__${clean}`;
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/, "")}`;
  const keyPad    = `${fourCode}__${clean.replace(/^(\D+)(\d)$/, "$10$2")}`;

  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPad] || null;
}

/**************************************************
 * SAVE SOGELMER
 **************************************************/
async function saveSogelmer(lines) {

  const FOUR_CODE = "10003";

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

    let plu = "";
    let designationInterne = L.designation;
    let cleanFromAF = "";

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    /**************** AF_MAP ****************/
    if (M) {
      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");
      cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();

      if (cleanFromAF) {
        designationInterne = cleanFromAF;
        L.designation = cleanFromAF;
      }

      if (M.nomLatin) L.nomLatin = M.nomLatin;
      if (M.zone)     L.zone = M.zone;
      if (M.sousZone) L.sousZone = M.sousZone;
      if (M.engin)    L.engin = M.engin;
    }

    /**************** Fallback fiche article ****************/
    if (plu && artMap[plu]) {
      const art = artMap[plu];

      const artDesignation =
        (art.Designation || art.designation || art.designationInterne || "").trim();

      if (!cleanFromAF && artDesignation) {
        designationInterne = artDesignation;
        L.designation = artDesignation;
      }

      if (art.Zone)     L.zone = art.Zone;
      if (art.SousZone) L.sousZone = art.SousZone;
      if (art.Engin)    L.engin = art.Engin;
    }

    /**************** SAVE LIGNE ****************/
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      fournisseurRef: L.refFournisseur,

      plu,
      designation: L.designation,
      designationInterne,

      nomLatin: L.nomLatin,

      zone: L.zone,
      sousZone: L.sousZone,
      fao: L.fao,
      autresFAO: L.autresFAO || [],
      engin: L.engin || "",

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

    /**************** PATCH AUTO-UPDATE après mapping ****************/
    if (!M) {
      setTimeout(async () => {
        const key = (`10003__${L.refFournisseur}`).toUpperCase();
        const snap = await getDoc(doc(db, "af_map", key));
        if (!snap.exists()) return;

        const mapped = snap.data();

        await updateDoc(
          doc(db, "achats", achatId, "lignes", lineId),
          {
            plu: mapped.plu || "",
            designationInterne: mapped.designationInterne || "",
            designation: mapped.designationInterne || "",
            updatedAt: serverTimestamp()
          }
        );
      }, 500);
    }

    /**************** Collect missing for popup ****************/
    if (!M) {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation,
        designationInterne,
        aliasFournisseur: L.designation,
        nomLatin: L.nomLatin || "",
        zone: L.zone || "",
        sousZone: L.sousZone || "",
        engin: L.engin || "",
        allergenes: "",
        achatId,
        ligneId: lineId
      });
    }

  }

  /**************** Update achat ****************/
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  /**************** Popup mapping ****************/
  if (missingRefs.length > 0) {
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

  // auto refresh
  setTimeout(() => location.reload(), 500);
}
