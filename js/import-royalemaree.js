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

  // Découpe par code article (5 chiffres en début de bloc)
  const blocks = text
    .split(/(?=\d{4,5}\s+\d+\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+[\d,]+)/g)
    .filter(b => /\d{4,5}/.test(b));

  for (const block of blocks) {
    // Expression régulière super tolérante : gère PAF, Pavillon, /Ean13, etc.
    const regex =
      /(\d{4,5})\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\s\S]+?)\s+([A-Z][a-zéèàêïîç]+(?:\s+[A-Za-zéèàêïîç]+){0,3})[\s\S]*?(?:\/\s*Ean13:\s*\d+)?[\s\S]*?\|\s*(Pêché|Elevé)\s*en\s*:?\s*([^|]+)\|([^|]*?)\|\s*N°\s*Lot\s*:\s*(\S+)/i;

    const m = block.match(regex);
    if (!m) continue;

    const [
      _, refFourn, colis, poidsColis, montant, prixKg, poidsTotal,
      designation, nomLatin, pecheOuElev, blocZone, blocEngin, lot
    ] = m;

    // Extraction FAO
    const mFAO = blocZone.match(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/i);
    let zone = mFAO ? `FAO${mFAO[1]}` : "";
    let sousZone = mFAO && mFAO[2] ? mFAO[2].toUpperCase().replace(/\./g, "") : "";

    // Cas élevage
    if (/Elevé/i.test(pecheOuElev)) {
      zone = "Élevage";
      sousZone = blocZone.replace(/.*Elevé\s+en\s*/i, "").trim();
    }

    const engin = (blocEngin || "").replace(/Engin\s*:\s*/i, "").trim();

    lines.push({
      refFournisseur: refFourn.trim(),
      designation: designation.replace(/\s{2,}/g, " ").trim(),
      nomLatin: nomLatin.trim(),
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

  console.log("🧾 Lignes extraites:", lines);
  return lines;
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
