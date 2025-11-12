/**************************************************
 * IMPORT CRIÉE ST-GILLES (81268)
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { manageAFMap } from "./manage-af-map.js";

const FOUR_CODE = "81268";   // CRIÉE ST-GILLES

/**************************************************
 * AF MAP
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

/**************************************************
 * Articles (fallback)
 **************************************************/
async function loadArticlesMap() {
  const snap = await getDocs(collection(db, "articles"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

/**************************************************
 * Fournisseur
 **************************************************/
async function loadSupplierInfo() {
  const snap = await getDoc(doc(db, "fournisseurs", FOUR_CODE));
  return snap.exists()
    ? snap.data()
    : { code: FOUR_CODE, nom: "CRIÉE ST-GILLES" };
}

/**************************************************
 * XLSX → workbook
 **************************************************/
function readWorkbookAsync(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        resolve(wb);
      } catch (e) {
        reject(e);
      }
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

/**************************************************
 * Heuristique — Détecter la colonne Désignation
 **************************************************/
function isDesignation(str) {
  if (!str) return false;
  const t = str.toString().trim();
  if (t.length < 4) return false;
  if (t.includes(" ")) return true;
  return t.length > 6;
}

function detectFormat(rows) {
  const row = rows[1] || [];

  const colB = row[1];
  const colC = row[2];

  const scoreB = isDesignation(colB) ? colB.toString().length : 0;
  const scoreC = isDesignation(colC) ? colC.toString().length : 0;

  if (scoreC > scoreB) return "FORMAT_B";
  return "FORMAT_A";
}

/**************************************************
 * HEADER ACHAT
 **************************************************/
async function createAchatHeader(supplier) {
  const ref = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
    fournisseurCode: supplier.code,
    fournisseurNom: supplier.nom,
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    statut: "new",
    type: "BL",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**************************************************
 * SAVE LIGNES
 **************************************************/
async function saveCrieeToFirestore(achatId, rows, afMap, artMap) {

  let totalHT = 0;
  let totalKg = 0;

  // détecter format
  const format = detectFormat(rows);
  console.log("📐 Format détecté:", format);

  const missingRefs = [];

  for (let i = 1; i < rows.length; i++) {

    const r = rows[i];
    if (!r?.length) continue;

    // REF FOURN
    let ref = (
      format === "FORMAT_B"
        ? r[1]    // col B
        : r[0]    // col A
    ) ?? "";

    ref = ref.toString().trim()
      .replace(/^0+/, "")
      .replace(/\s+/g, "")
      .replace(/\//g, "_");

    // LOCK désignation
    const designation = format === "FORMAT_B"
      ? (r[2] ?? "")   // col C
      : (r[1] ?? "");  // col B

    const nomLatin =
      format === "FORMAT_B"
        ? (r[3] ?? "")     // col D
        : (r[2] ?? "");    // col C

    // colonnes poids/prix/total selon format
    const prixHTKg =
      format === "FORMAT_B"
        ? parseFloat(r[7] ?? 0)   // H
        : parseFloat(r[6] ?? 0);  // G

    const poidsKg =
      format === "FORMAT_B"
        ? parseFloat(r[8] ?? 0)   // I
        : parseFloat(r[7] ?? 0);  // H

    const montantHT =
      format === "FORMAT_B"
        ? parseFloat(r[9] ?? 0)   // J
        : parseFloat(r[8] ?? 0);  // I

    // Zone / sous-zone (fusion)
    const zone     = format === "FORMAT_B" ? (r[12] ?? "") : (r[12] ?? "");
    const sousZone = format === "FORMAT_B" ? (r[13] ?? "") : (r[13] ?? "");
    const fao      = (zone && sousZone) ? `FAO${zone}${sousZone}` : "";

    const engin =
      format === "FORMAT_B"
        ? (r[14] ?? "")    // O
        : (r[14] ?? "");

    // =============================
    //  AF MAP
    // =============================
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const M = afMap[key];

    let plu = (M?.plu ?? "").toString().trim();

    // fix .0
    if (plu.endsWith(".0")) plu = plu.slice(0, -2);

    let designationInterne = M?.designationInterne || designation;
    let allergenes = M?.allergenes || "";

    // =============================
    //  fallback fiche Article
    // =============================
    if (!plu) {
      const art = Object.values(artMap).find(a =>
        a.designation?.toUpperCase() === designation.toUpperCase()
      );
      if (art) {
        plu = art.id || plu;
        if (art.zone) zone = art.zone;
        if (art.sousZone) sousZone = art.sousZone;
        if (art.engin) engin = art.engin;
      }
    }

    // collecte missing map
    if (!M?.plu) {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: ref,
        designation,
        achatId,
      });
    }

    totalHT += montantHT;
    totalKg += poidsKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
      fournisseurRef: ref,

      plu,
      designation,
      designationInterne,
      nomLatin,

      zone,
      sousZone,
      fao,
      engin,
      allergenes,

      poidsKg,
      prixHTKg,
      prixKg: prixHTKg,
      montantHT,
      montantTTC: montantHT,

      colis: 0,
      poidsColisKg: 0,
      poidsTotalKg: poidsKg,

      received: false,
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

  // popup mapping manquant
  if (missingRefs.length > 0) {
    console.log("🔎 Missing refs:", missingRefs);
    await manageAFMap(missingRefs);
  }
}

/**************************************************
 * ENTRY
 **************************************************/
export async function importCrieeStGilles(file) {

  const afMap = await loadAFMap();
  const artMap = await loadArticlesMap();
  const supplier = await loadSupplierInfo();

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);
  await saveCrieeToFirestore(achatId, rows, afMap, artMap);

  alert("✅ Import Criée ST-GILLES OK");
  location.reload();
}
