/**************************************************
 * IMPORT ROYALE MAREE (10004)
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * PDF TEXT EXTRACT
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) throw new Error("PDF.js non chargé. Ajoute <script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'>");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str);
    fullText += strings.join(" ") + "\n";
  }
  return fullText;
}

/**************************************************
 * PARSE LINES
 **************************************************/
function parseRoyaleMareeLines(text) {
  const lines = [];
  const rows = [];

  // 1️⃣ Nettoyage du texte brut
  let clean = text
    .replace(/\s+/g, " ")        // espaces multiples → simple
    .replace(/[,;]/g, ",")       // normalisation virgules
    .replace(/€/g, "")           // supprime €
    .replace(/\(pour Facture\)/gi, "")
    .replace(/\s+\|\s+/g, "|")   // supprime espaces avant/après |
    .replace(/\s*Page\s*\d+\/\d+\s*/gi, " ")
    .replace(/Transp\..+?Départ\s*:/gi, " "); // coupe l'en-tête parasite

  // 2️⃣ Découpage des blocs par code article (4 à 5 chiffres)
  const parts = clean.split(/(?=\b\d{4,5}\s+\d+\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+[\d,]+)/g);

  for (let part of parts) {
    const matchHead = part.match(
      /(\d{4,5})\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([A-Z0-9éèàç+\-\s/]+?)(?=\s+[A-Z][a-z])/i
    );
    if (!matchHead) continue;

    const [
      _,
      refFourn,
      colis,
      poidsColis,
      montant,
      prixKg,
      poidsTotal,
      designation
    ] = matchHead;

    // 3️⃣ Extraction du reste : nom latin, FAO, engin, lot, etc.
    const tail = part.slice(matchHead.index + matchHead[0].length);
    const nomLatin = (tail.match(/[A-Z][a-z]+\s+[a-z]+\s*[A-Z]?[a-z]*/i)?.[0] || "").trim();

    // Bloc de traçabilité (FAO, Engin…)
    const blocTrace = tail.match(/(Pêché|Elevé).+?Lot\s*:\s*\S+/i);
    const traceTxt = blocTrace ? blocTrace[0] : "";

    let zone = "";
    let sousZone = "";
    let engin = "";
    let lot = "";

    // FAO
    const mFAO = traceTxt.match(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/i);
    if (mFAO) {
      zone = `FAO${mFAO[1]}`;
      sousZone = mFAO[2] ? mFAO[2].toUpperCase().replace(/\./g, "") : "";
    }

    // Élevage
    if (/Elevé/i.test(traceTxt)) {
      zone = "Élevage";
      sousZone = (traceTxt.match(/en\s*:?([A-Za-z\s]+)/i)?.[1] || "").trim();
    }

    // Engin
    const mEngin = traceTxt.match(/Engin\s*:\s*([^|]+)/i);
    if (mEngin) engin = mEngin[1].trim();

    // Lot
    const mLot = traceTxt.match(/Lot\s*:\s*(\S+)/i);
    if (mLot) lot = mLot[1].trim();

    rows.push({
      refFournisseur: refFourn.trim(),
      designation: designation.replace(/\s{2,}/g, " ").trim(),
      nomLatin,
      colis: parseInt(colis),
      poidsColisKg: parseFloat(poidsColis.replace(",", ".")),
      poidsTotalKg: parseFloat(poidsTotal.replace(",", ".")),
      prixKg: parseFloat(prixKg.replace(",", ".")),
      montantHT: parseFloat(montant.replace(",", ".")),
      zone,
      sousZone,
      engin,
      lot
    });
  }

  console.log("🧾 Lignes extraites:", rows);
  return rows;
}

/**************************************************
 * FIRESTORE SAVE
 **************************************************/
async function saveRoyaleMaree(lines) {
  if (!lines.length) throw new Error("Aucune ligne trouvée dans le PDF.");

  const FOUR_CODE = "10004";
  const supplier = { code: FOUR_CODE, nom: "Royale Marée" };

  // Crée un en-tête achat
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

  let totalHT = 0, totalKg = 0;

  for (const L of lines) {
    totalHT += L.montantHT;
    totalKg += L.poidsTotalKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu: "",
      fournisseurRef: L.refFournisseur,
      fao: `${L.zone} ${L.sousZone}`.trim(),
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp(),
  });

  alert(`✅ ${lines.length} lignes importées pour Royale Marée`);
}

/**************************************************
 * MAIN ENTRY
 **************************************************/
export async function importRoyaleMaree(file) {
  const text = await extractTextFromPdf(file);
  console.log("🔍 PDF brut (début):", text.slice(0, 1000));
  const lines = parseRoyaleMareeLines(text);
  console.log("✅ Lignes détectées:", lines);
  await saveRoyaleMaree(lines);
}
