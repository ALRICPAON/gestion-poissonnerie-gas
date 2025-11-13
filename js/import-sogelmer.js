/**************************************************
 * IMPORT SOGELMER (10003)
 * Compatible PDF – version stable du 13/11/2025
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

function buildFAO(zone, sousZone) {
  if (!zone) return "";
  if (/elev/i.test(zone)) return "ÉLEVAGE";
  sousZone = sousZone ? sousZone.replace(/[^IVX]/gi,"").toUpperCase() : "";
  return (`FAO ${zone.replace(/[^0-9]/g,"")}` + (sousZone ? " " + sousZone : "")).trim();
}

async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let txt = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const c = await page.getTextContent();
    txt += c.items.map(i => i.str).join("\n") + "\n";
  }

  console.log("🔍 PDF SOGELMER brut:", txt.slice(0,2000));
  return txt;
}

/**************************************************
 * PARSE SOGELMER (format spécial)
 **************************************************/
function parseSogelmer(text) {
  const rows = [];
  const lines = text.split("\n").map(l => l.trim()).filter(l => l);

  let i = 0;

  while (i < lines.length) {

    /** 1) CODE article SOGELMER = 5–10 caractères alphanumériques */
    if (/^[A-Z0-9]{5,12}$/.test(lines[i]) && !/PAGE|SOGELMER|CHALLANS/i.test(lines[i])) {

      const refFournisseur = lines[i];
      i++;

      /** 2) Désignation */
      const designation = (lines[i] || "").trim();
      i++;

      /** 3) Tableau quantités (8 lignes fixes) */
      const colis        = parseInt((lines[i++]||"0").replace(",", "."), 10);
      const pdsUnit      = parseFloat((lines[i++]||"0").replace(",", "."));
      const poidsTotalKg = parseFloat((lines[i++]||"0").replace(",", "."));
      const uv           = lines[i++] || "KG";
      const lot          = lines[i++] || "";
      const prixKg       = parseFloat((lines[i++]||"0").replace(",", "."));
      const montantHT    = parseFloat((lines[i++]||"0").replace(",", "."));
      const tva          = lines[i++] || "";

      /** 4) Traçabilité */
      let nomLatin = "";
      let zone = "";
      let sousZone = "";
      let engin = "";

      const trace = lines[i] || "";
      if (/FAO/i.test(trace)) {
        // Ex: "Molva molva - FAO 27 VI & autres ss zones - Chalut"
        const latinMatch = trace.match(/^([A-Za-z ]+)\s*-/);
        if (latinMatch) nomLatin = latinMatch[1].trim();

        const faoMatch = trace.match(/FAO\s*([0-9]{1,3})/i);
        if (faoMatch) zone = faoMatch[1];

        const ssMatch = trace.match(/FAO[0-9]+\s+([IVX]+)/i);
        if (ssMatch) sousZone = ssMatch[1];

        const engMatch = trace.match(/(Chalut|Ligne|Filet|Purse|Traine|Tournant)/i);
        if (engMatch) engin = engMatch[1];

        i++;
      }

      rows.push({
        refFournisseur,
        designation,
        nomLatin,
        colis,
        poidsColisKg: pdsUnit,
        poidsTotalKg,
        uv,
        lot,
        prixKg,
        montantHT,
        zone,
        sousZone,
        engin
      });
    }

    i++;
  }

  console.log("📦 Lignes SOGELMER extraites:", rows);
  return rows;
}

/**************************************************
 * FIRESTORE SAVE
 **************************************************/
export async function importSogelmer(file) {

  const text = await extractTextFromPdf(file);
  const lines = parseSogelmer(text);

  if (!lines.length) throw new Error("Aucune ligne détectée dans le BL Sogelmer");

  const FOUR_CODE = "10003";

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
    updatedAt: serverTimestamp()
  });

  let totalHT = 0;
  let totalKg = 0;

  for (const L of lines) {
    totalHT += L.montantHT;
    totalKg += L.poidsTotalKg;

    await addDoc(collection(db, "achats", achatRef.id, "lignes"), {
      ...L,
      fao: buildFAO(L.zone, L.sousZone),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  await updateDoc(doc(db, "achats", achatRef.id), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  alert(`✅ ${lines.length} lignes importées pour Sogelmer`);
}
