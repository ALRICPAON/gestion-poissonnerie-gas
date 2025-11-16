/**************************************************
 * IMPORT SOGELMER (10003)
 * Version finale — multi-FAO, multi Latin, AF_MAP OK
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs, getDoc
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
 * Normalisation réf SOGELMER
 **************************************************/
function normalizeRef(ref) {
  if (!ref) return "";
  let r = ref.trim().replace("/", "_");
  r = r.replace(/^(\D+)(\d)$/, "$1" + "0" + "$2");
  return r.toUpperCase();
}

/**************************************************
 * Multi-FAO SOGELMER (identique Distrimer)
 **************************************************/
function extractFAOs(bio) {
  if (!bio) return [];

  const blocks = bio
    .split(/FAO/i)
    .slice(1)
    .map(b => b.trim());

  const out = [];

  for (let blk of blocks) {
    blk = blk.split(/Chalut|Casier|Ligne|Filet|Mail|-/i)[0].trim();

    const numMatch = blk.match(/^([0-9]{1,3})/);
    if (!numMatch) continue;

    const num = numMatch[1];
    let rest = blk.replace(num, "").trim();

    const parts = rest.split(/et|\/|,/i).map(s => s.trim());

    for (let p of parts) {
      const m = p.match(/^([IVX]+)([A-Za-z]?)?/i);
      if (!m) continue;

      const roman = (m[1] || "").toUpperCase();
      let letter = (m[2] || "").toLowerCase();

      if (/ouest|ecosse/i.test(p)) letter = "";

      out.push(`FAO ${num} ${roman}${letter}`.trim());
    }
  }

  return [...new Set(out)];
}

/**************************************************
 * Parse PDF → lignes SOGELMER (nouveau)
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
      prixKg = parseFloat(lines[i + 7].replace("€", "").replace(",", "."));

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€", "").replace(",", "."));

    const bio = (lines[i + 10] || "").trim();

    /***********************
     * Multi nom latin
     ***********************/
    let nomLatin = "";
    const latinList = bio.match(/[A-Z][a-z]+(?: [a-z]+)*/g);
    if (latinList) nomLatin = latinList.join(", ");

    /***********************
     * Multi-FAO
     ***********************/
    const faos = extractFAOs(bio);
    const fao = faos.join(", ");

    // zone / sous-zone = uniquement si 1 FAO
    let zone = "";
    let sousZone = "";
    if (faos.length === 1) {
      const parts = faos[0].split(" ");
      zone = `${parts[0]} ${parts[1]}`;
      sousZone = parts[2] || "";
    }

    /***********************
     * Engin
     ***********************/
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|Casier|FILTS/gi);
    if (engMatch) engin = engMatch[0];

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

      zone,
      sousZone,
      engin,

      fao,   // string
      faos   // array
    });

    i += 11;
  }

  return rows;
}

/**************************************************
 * AF_MAP smart match (identique Distrimer)
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {

  const clean = (ref || "").trim().toUpperCase();

  const keyExact  = `${fourCode}__${clean}`;
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/, "")}`;
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
 * SAVE SOGELMER (copie 100% Distrimer)
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

    let plu = "";
    let designationInterne = (L.designation || "").trim();
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;
    let faos = L.faos;

    let cleanFromAF = "";

    /**************************************************
     * AF_MAP PRIORITÉ
     **************************************************/
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

      if (!fao && M.zone)
        fao = buildFAO(`FAO ${M.zone}`, M.sousZone);
    }

    /**************************************************
     * ARTICLE fallback
     **************************************************/
    if (plu && artMap[plu]) {
      const art = artMap[plu];

      const artDesignation =
        (art.Designation || art.designation || art.designationInterne || "").trim();

      if (!cleanFromAF && artDesignation) {
        L.designation = artDesignation;
        designationInterne = artDesignation;
      }

      if (!zone && (art.Zone || art.zone))
        zone = art.Zone || art.zone;

      if (!sousZone && (art.SousZone || art.sousZone))
        sousZone = art.SousZone || art.sousZone;

      if (!engin && (art.Engin || art.engin))
        engin = art.Engin || art.engin;

      if (!fao)
        fao = buildFAO(zone, sousZone);
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
      faos,
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
     * PATCH AUTO après popup
     **************************************************/
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

        console.log("🔄 Ligne SOGELMER mise à jour après mapping :", lineId);
      }, 500);
    }

    /**************************************************
     * MANQUANTS → popup AF_MAP (identique Distrimer)
     **************************************************/
    if (!M) {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation || "",
        designationInterne: designationInterne || "",
        aliasFournisseur: L.designation || "",
        nomLatin: L.nomLatin || "",
        zone: zone || "",
        sousZone: sousZone || "",
        engin: engin || "",
        allergenes: allergenes || "",
        achatId,
        ligneId: lineId
      });
    }
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

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
