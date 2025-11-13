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
function isSogelmerCode(raw) {
  const s = raw.trim();

  if (!s) return false;

  // pas d'espace
  if (/\s/.test(s)) return false;

  // exclure les numéros purs
  if (/^\d+$/.test(s)) return false;

  // exclure ref type C5100022
  if (/^[A-Z]\d+$/.test(s)) return false;

  // exclure lots : 05131102998
  if (/^\d{8,}$/.test(s)) return false;

  // doit contenir au moins 3 lettres
  if ((s.match(/[A-Z]/gi) || []).length < 3) return false;

  // longueur correcte
  if (s.length < 5 || s.length > 12) return false;

  return true;
}


/**************************************************
 * 🔍 Détecteur de vrai code produit SOGELMER
 **************************************************/
function isRealProductCode(s) {
  const txt = s.trim();

  // ❌ Exclure entête / faux codes
  if (/^(ARTICLE|DESIGNATION|COLIS|PDS|QUANTITE|UV|LOT|TVA|CLIENT)$/i.test(txt))
    return false;

  // ❌ Exclure numéros purement digitaux (client, BL, lots internes…)
  if (/^\d{5,}$/.test(txt)) return false;

  // ✔ Format typique : FILJUL58 / RAI121F/6 / DARCON / EMISP/6 / etc.
  return /^[A-Z]{2,6}[A-Z0-9/]{1,6}$/i.test(txt);
}

/**************************************************
 * 🎯 Extraction FAO : conserve "autres ss zones"
 **************************************************/
function extractFAO_Sogelmer(raw) {
  let zone = "";
  let sousZone = "";
  let fao = "";

  const m = raw.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
  if (m) {
    zone = `FAO ${m[1]}`;
    sousZone = (m[2] || "").trim();
  }

  // autres sous zones
  if (/autres\s+ss\s+zones/i.test(raw)) {
    if (sousZone) sousZone += " & AUTRES SS ZONES";
    else sousZone = "AUTRES SS ZONES";
  }

  if (zone) {
    fao = (zone + " " + sousZone).trim();
    fao = fao.replace(/\s+/g, " ");
  }

  return { zone, sousZone, fao };
}

/**************************************************
 * ⚓ Normalisation engins Sogelmer
 **************************************************/
function normalizeEngin(raw) {
  const t = raw.toUpperCase();

  if (/MAIL/i.test(t)) return "FILET MAILLANT";
  if (/FILT?S?/i.test(t)) return "FILET TOURNANT";
  if (/CHALUT/i.test(t)) return "CHALUT";
  if (/LIGNE/i.test(t)) return "LIGNE";

  return raw.trim();
}

/**************************************************
 * 📄 Parse BL SOGELMER — Version stable
 **************************************************/
export function parseSogelmer(text) {
  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0);

  let current = null;
  let step = 0;

  const push = () => {
    if (current && current.designation.length > 2) rows.push(current);
    current = null;
    step = 0;
  };

  for (let raw of lines) {

    // 🎯 DÉTECTION DU CODE
    if (isSogelmerCode(raw)) {
      push();
      current = {
        refFournisseur: raw,
        designation: "",
        colis: 0,
        poidsColisKg: 0,
        poidsTotalKg: 0,
        uv: "",
        lot: "",
        prixKg: 0,
        montantHT: 0,
        nomLatin: "",
        zone: "",
        sousZone: "",
        engin: "",
        fao: ""
      };
      step = 1;
      continue;
    }

    if (!current) continue;

    // 🧱 ETAPE 1 → designation
    if (step === 1) {
      current.designation = raw;
      step = 2;
      continue;
    }

    // 🧱 ETAPE 2 → colis
    if (step === 2 && /^\d+$/.test(raw)) {
      current.colis = parseInt(raw);
      step = 3;
      continue;
    }

    // 🧱 ETAPE 3 → pds unit
    if (step === 3 && /^[0-9]+([.,][0-9]+)?$/.test(raw)) {
      current.poidsColisKg = parseFloat(raw.replace(",", "."));
      step = 4;
      continue;
    }

    // 🧱 ETAPE 4 → quantité
    if (step === 4 && /^[0-9]+([.,][0-9]+)?$/.test(raw)) {
      current.poidsTotalKg = parseFloat(raw.replace(",", "."));
      step = 5;
      continue;
    }

    // 🧱 ETAPE 5 → UV
    if (step === 5) {
      current.uv = raw;
      step = 6;
      continue;
    }

    // 🧱 ETAPE 6 → lot
    if (step === 6) {
      current.lot = raw;
      step = 7;
      continue;
    }

    // 🧱 ETAPE 7 → prix HT
    if (step === 7 && /€/.test(raw)) {
      current.prixKg = parseFloat(raw.replace("€", "").replace(",", "."));
      step = 8;
      continue;
    }

    // 🧱 ETAPE 8 → montant HT
    if (step === 8 && /€/.test(raw)) {
      current.montantHT = parseFloat(raw.replace("€", "").replace(",", "."));
      step = 9;
      continue;
    }

    // 🧾 Après montant HT → bloc bio
    if (step >= 9) {
      // latin
      const mLatin = raw.match(/^([A-Z][a-z]+(?: [a-z]+)?)/);
      if (mLatin) current.nomLatin = mLatin[1];

      // engin
      const eng = raw.match(/Chalut|Mail|FILT|Filet|Ligne/i);
      if (eng) current.engin = eng[0];

      // FAO
      const mFao = raw.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
      if (mFao) {
        current.zone = `FAO ${mFao[1]}`;
        current.sousZone = mFao[2] || "";
        if (/autres ss zones/i.test(raw)) {
          current.sousZone += " & AUTRES SS ZONES";
        }
        current.fao = `${current.zone} ${current.sousZone}`.trim();
      }
    }
  }

  push();

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
