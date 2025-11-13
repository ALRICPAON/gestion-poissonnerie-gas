/**************************************************
 * IMPORT SOGELMER (10003)
 * Version stable — blocs exacts du BL
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * PDF RAW TEXT
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let raw = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const c = await page.getTextContent();
    raw += c.items.map(i => i.str).join("\n") + "\n";
  }

  console.log("🔍 PDF SOGELMER brut:", raw.slice(0, 1500));
  return raw;
}

/**************************************************
 * Normalisation ENGIN
 **************************************************/
function normalizeEngin(e) {
  if (!e) return "";

  const x = e.toUpperCase();

  if (x.includes("FILMAIL")) return "Filet maillant";
  if (x.includes("FILTS") || x.includes("TOURN")) return "Filet tournant";
  if (x.includes("FILET")) return "Filet";
  if (x.includes("LIGNE")) return "Ligne";
  if (x.includes("CHALUT")) return "Chalut";

  return e;
}

/**************************************************
 * PARSE SOGELMER (détection par blocs)
 **************************************************/
export function parseSogelmer(text) {

  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Code produit = majuscules + chiffres + / -
  function isArticleCode(s) {
    return (
      /^[A-Z0-9\/-]+$/.test(s) &&
      !/^\d+$/.test(s) &&
      s.length >= 4 &&
      /[A-Z]/.test(s)
    );
  }

  let i = 0;

  while (i < lines.length) {
    const L = lines[i];

    if (!isArticleCode(L)) {
      i++;
      continue;
    }

    // 🔥 Début d’un bloc produit
    const refF = L;
    const designation = (lines[i + 1] || "").trim();

    const colis = parseInt(lines[i + 2] || "0", 10);
    const poidsColisKg = parseFloat((lines[i + 3] || "").replace(",", "."));
    const poidsTotalKg = parseFloat((lines[i + 4] || "").replace(",", "."));
    const uv = (lines[i + 5] || "").trim();
    const lot = (lines[i + 6] || "").trim();

    let prixKg = 0;
    if ((lines[i + 7] || "").includes("€"))
      prixKg = parseFloat(lines[i + 7].replace("€", "").replace(",", "."));

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€", "").replace(",", "."));

    // Ligne bio
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

      if (/autres ss zones/i.test(bio))
        sousZone += " & AUTRES SS ZONES";

      fao = `${zone} ${sousZone}`.trim();
    }

    // Engin
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|FILTS/gi);
    if (engMatch) engin = normalizeEngin(engMatch[0]);

    // Ajout du produit
    rows.push({
      refFournisseur: refF,
      designation,
      colis,
      poidsColisKg,
      poidsTotalKg,
      uv,
      lot,
      prixKg,
      montantHT,
      nomLatin,
      zone,
      sousZone,
      engin,
      fao
    });

    i += 11; // passer au bloc suivant
  }

  console.log("📦 Lignes SOGELMER extraites:", rows);
  return rows;
}

/**************************************************
 * SAUVEGARDE FIRESTORE
 **************************************************/
async function saveSogelmer(lines) {
  if (!lines.length) throw new Error("Aucune ligne détectée dans le BL Sogelmer");

  const FOUR_CODE = "10003"; // ✔ ton id fournisseur
  const supplier = { code: FOUR_CODE, nom: "Sogelmer" };

  // Charger AF_MAP & Articles
  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => { afMap[d.id.toUpperCase()] = d.data(); });

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString().trim()] = a;
  });

  // Créer en-tête achat
  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code,
    fournisseurNom: supplier.nom,
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const achatId = achatRef.id;

  let totalHT = 0;
  let totalKg = 0;
  const missing = [];

  for (const L of lines) {
    totalHT += L.montantHT || 0;
    totalKg += L.poidsTotalKg || 0;

    const keyExact = `${FOUR_CODE}__${L.refFournisseur}`.toUpperCase();
    const M = afMap[keyExact] || null;

    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;
    let nomLatin = L.nomLatin;

    // 1) AF_MAP (prioritaire)
    if (M) {
      plu = (M.plu || "").toString();
      if (M.designationInterne)
        designationInterne = M.designationInterne;

      if (!nomLatin && M.nomLatin) nomLatin = M.nomLatin;
      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = normalizeEngin(M.engin);

      if (!fao) fao = `${zone} ${sousZone}`.trim();
    } else {
      missing.push(L.refFournisseur);
    }

    // 2) Articles database
    const art = plu ? artMap[plu] : null;
    if (art) {
      if (art.designation) designationInterne = art.designation;
      if (!nomLatin && art.nomLatin) nomLatin = art.nomLatin;

      if (!zone && art.zone) zone = art.zone;
      if (!sousZone && art.sousZone) sousZone = art.sousZone;
      if (!engin && art.engin) engin = normalizeEngin(art.engin);

      if (!fao) fao = `${zone} ${sousZone}`.trim();
    }

    // Sauvegarde
    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      designation: L.designation,
      designationInterne,
      nomLatin,
      plu,
      allergenes,
      colis: L.colis,
      poidsColisKg: L.poidsColisKg,
      poidsTotalKg: L.poidsTotalKg,
      uv: L.uv,
      lot: L.lot,
      prixKg: L.prixKg,
      montantHT: L.montantHT,
      montantTTC: L.montantHT,
      zone,
      sousZone,
      engin,
      fao,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: Number(totalHT.toFixed(2)),
    montantTTC: Number(totalHT.toFixed(2)),
    totalKg: Number(totalKg.toFixed(3)),
    updatedAt: serverTimestamp(),
  });

  if (missing.length)
    console.warn("⚠️ Références SOGELMER manquantes dans AF_MAP:", missing);

  alert(`✅ ${lines.length} lignes importées pour SOGELMER`);
  location.reload();
}

/**************************************************
 * MAIN
 **************************************************/
export async function importSogelmer(file) {
  const txt = await extractTextFromPdf(file);
  const lines = parseSogelmer(txt);
  await saveSogelmer(lines);
}
