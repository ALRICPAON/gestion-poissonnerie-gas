/**************************************************
 * IMPORT DISTRIMER (10002)
 *  Version stable – 17/11/2025
 *  🔥 Copie conforme SOGELMER avec ID 10002
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp,
  updateDoc, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * Recherche AF_MAP
 **************************************************/
function findAFMapEntry(afMap, fourCode, refFournisseur) {
  if (!refFournisseur) return null;
  const refStr = refFournisseur.toString().trim();
  const keyExact = `${fourCode}__${refStr}`.toUpperCase();
  const keyNoZero = `${fourCode}__${refStr.replace(/^0+/, "")}`.toUpperCase();
  const keyPad = `${fourCode}__${refStr.padStart(5, "0")}`.toUpperCase();
  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPad] || null;
}

/**************************************************
 * Extraction texte PDF
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
 * Parse Distrimer (identique Sogelmer)
 **************************************************/
function parseDistrimer(text) {
  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length);

  const isRef = s => /^[A-Z0-9\/-]{3,20}$/.test(s);
  const isNum = s => /^[\d]+(?:,\d+)?$/.test(s);

  let current = null;
  let stage = 0;

  for (let raw of lines) {
    // Nouveau produit
    if (isRef(raw) && raw.length >= 3 && !/€/.test(raw)) {
      if (current) rows.push(current);

      current = {
        refFournisseur: raw,
        designation: "",
        nomLatin: "",
        zone: "",
        sousZone: "",
        engin: "",
        colis: 0,
        poidsUnitaire: 0,
        poidsTotalKg: 0,
        prixKg: 0,
        montantHT: 0,
        lot: ""
      };
      stage = 1;
      continue;
    }

    if (!current) continue;

    // Ligne “Colis  Pds Unit  Quantité  Lot  Prix”
    if (stage === 1 && isNum(raw)) {
      current.colis = parseFloat(raw.replace(",", "."));
      stage = 2;
      continue;
    }
    if (stage === 2 && isNum(raw)) {
      current.poidsUnitaire = parseFloat(raw.replace(",", "."));
      stage = 3;
      continue;
    }
    if (stage === 3 && isNum(raw)) {
      current.poidsTotalKg = parseFloat(raw.replace(",", "."));
      stage = 4;
      continue;
    }
    if (stage === 4 && /^[A-Za-z0-9]+$/.test(raw)) {
      current.lot = raw;
      stage = 5;
      continue;
    }
    if (stage === 5 && raw.includes("€")) {
      const m = raw.match(/([\d,]+)\s*€/);
      if (m) current.prixKg = parseFloat(m[1].replace(",", "."));
      stage = 6;
      continue;
    }
    if (stage === 6 && raw.includes("€")) {
      const m = raw.match(/([\d,]+)\s*€/);
      if (m) current.montantHT = parseFloat(m[1].replace(",", "."));
      stage = 7;
      continue;
    }

    // Nom latin + FAO + Engin
    if (/FAO/i.test(raw)) {
      const mFAO = raw.match(/FAO\s*([0-9]{1,3})\s*([IVXa-z]*)/i);
      if (mFAO) {
        current.zone = "FAO " + mFAO[1];
        current.sousZone = (mFAO[2] || "").replace(/\./g, "").toUpperCase();
      }

      const mLatin = raw.match(/^([A-Z][a-z]+(?:\s+[a-z]+)*)/);
      if (mLatin) current.nomLatin = mLatin[1];

      if (/chalut/i.test(raw)) current.engin = "Chalut";
      if (/casier/i.test(raw)) current.engin = "Casier";
      continue;
    }

    // Désignation
    if (stage === 7 && !raw.includes("€")) {
      current.designation += " " + raw;
    }
  }

  if (current) rows.push(current);
  return rows;
}

/**************************************************
 * SAVE + POPUP AF_MAP
 **************************************************/
async function saveDistrimer(lines) {
  const FOUR_CODE = "10002";

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => (afMap[d.id.toUpperCase()] = d.data()));

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString().trim()] = a;
  });

  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: FOUR_CODE,
    fournisseurNom: "DistriMer",
    type: "BL",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const achatId = achatRef.id;
  let totalHT = 0, totalKg = 0;
  const missingRefs = [];

  for (const L of lines) {
    totalHT += L.montantHT || 0;
    totalKg += L.poidsTotalKg || 0;

    let plu = "";
    let designationInterne = L.designation;

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    if (M) {
      plu = (M.plu || "").toString();
      if (M.designationInterne) designationInterne = M.designationInterne;
    } else {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation,
        designationInterne: L.designation,
        nomLatin: L.nomLatin,
        zone: L.zone,
        sousZone: L.sousZone,
        engin: L.engin,
        allergenes: "",
        achatId,
        lineId: null
      });
    }

    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      ...L,
      plu,
      designationInterne,
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Assoc lineId for popup
    missingRefs.forEach(ref => {
      if (ref.refFournisseur === L.refFournisseur && ref.lineId === null) {
        ref.lineId = lineRef.id;
      }
    });

    // Auto patch after popup
    if (!M) {
      const key = `${FOUR_CODE}__${L.refFournisseur}`.toUpperCase();
      setTimeout(async () => {
        const snap = await getDoc(doc(db, "af_map", key));
        if (!snap.exists()) return;

        const mapped = snap.data();
        await updateDoc(doc(db, "achats", achatId, "lignes", lineRef.id), {
          plu: mapped.plu || "",
          designation: mapped.designationInterne || "",
          designationInterne: mapped.designationInterne || "",
          updatedAt: serverTimestamp()
        });

        console.log("🔄 Distrimer — Ligne MAJ après popup :", lineRef.id);
      }, 400);
    }
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg: totalKg
  });

  if (missingRefs.length > 0) {
    const { manageAFMap } = await import("./manage-af-map.js");
    await manageAFMap(missingRefs);
    alert("🔄 PLU associés → recharge la page");
    return;
  }

  alert(`✅ ${lines.length} lignes importées (DistriMer)`);
  location.reload();
}

/**************************************************
 * Entrée principale
 **************************************************/
export async function importDistrimer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseDistrimer(text);
  await saveDistrimer(lines);
}
