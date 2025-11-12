/**************************************************
 * IMPORT CRIÉE — PLU en colonne A ou B
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

/**************************************************
 * FONCTIONS COMMUNES
 **************************************************/

async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};

  snap.forEach(d => {
    const data = d.data();
    const id = d.id.toUpperCase();
    // On garde les deux codes criée ensemble
    if (id.startsWith("81268__") || id.startsWith("81269__")) {
      map[id] = data;
    }
  });

  return map;
}

async function loadArticlesMap() {
  const snap = await getDocs(collection(db, "articles"));
  const map = {};
  snap.forEach(d => map[d.id] = d.data());
  return map;
}

async function loadSupplierInfo(code) {
  const snap = await getDoc(doc(db, "fournisseurs", code));
  return snap.exists()
    ? snap.data()
    : { code, nom: "CRIÉE" };
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
 * Convertit sous-zone → chiffres romains
 **************************************************/
function toRoman(num) {
  num = parseInt(num, 10);
  if (isNaN(num) || num <= 0) return "";
  const map = [
    [1000,"M"], [900,"CM"], [500,"D"], [400,"CD"],
    [100,"C"], [90,"XC"], [50,"L"], [40,"XL"],
    [10,"X"], [9,"IX"], [5,"V"], [4,"IV"], [1,"I"]
  ];
  let out = "";
  for (const [value, numeral] of map) {
    while (num >= value) {
      out += numeral;
      num -= value;
    }
  }
  return out;
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
async function saveLines(opts) {

  const {
    achatId,
    rows,
    afMap,
    artMap,
    FOUR_CODE,
    colPLU,
    colDesignation,
    colNomLatin,
    colPrixKg,
    colPoidsKg,
    colMontantHT,
    colZone,
    colSousZone,
    colEngin,
  } = opts;

  let totalHT = 0;
  let totalKg = 0;
  const missingRefs = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.length) continue;

    let ref = (r[colPLU] ?? "").toString().trim();
    ref = ref.toString().replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    let designation = (r[colDesignation] ?? "").toString().trim();
    let nomLatin    = (r[colNomLatin]   ?? "").toString().trim();

    let prixHTKg    = parseFloat(r[colPrixKg]    ?? 0);
    let poidsKg     = parseFloat(r[colPoidsKg]   ?? 0);
    let montantHT   = parseFloat(r[colMontantHT] ?? 0);

    let zone        = (r[colZone]     ?? "").toString().trim();
    let sousZone    = (r[colSousZone] ?? "").toString().trim();
    let engin       = (r[colEngin]    ?? "").toString().trim();

 /**************************************************
 * FAO — robust parsing (zone + sous-zone)
 **************************************************/
function extractZoneNum(s) {
  const t = (s || "").toString();
  // grab first 1–3 digit sequence (e.g., (27), FAO 27, 27)
  const m = t.match(/(?:FAO\s*)?(\d{1,3})/i);
  return m ? m[1] : "";
}

function extractSousZoneRomanOrNum(s) {
  const t = (s || "").toString().trim();

  // 1) Roman anywhere? (I..XII)
  const mRoman = t.match(/\b(M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{1,3}))\b/i);
  if (mRoman && mRoman[1]) return mRoman[1].toUpperCase();

  // 2) Number inside parentheses e.g. (080), (08), (8)
  const mParen = t.match(/\((\d{1,3})\)/);
  if (mParen) {
    let n = mParen[1];

    // normalize special 3-digit codes like 080 → 8
    if (n.length === 3 && n[0] === '0') {
      // strip leading zeros → "080" -> "80" -> if ends with '0', divide by 10
      n = n.replace(/^0+/, ''); // "080" -> "80"
      if (/^\d+$/.test(n) && parseInt(n,10) > 12 && parseInt(n,10) % 10 === 0) {
        n = String(parseInt(n,10) / 10); // "80" -> "8"
      }
    }

    // also handle "08" -> "8"
    if (/^0\d$/.test(n)) n = n.slice(1);

    const ni = parseInt(n, 10);
    if (!isNaN(ni) && ni > 0) return toRoman(ni);
  }

  // 3) Plain small number anywhere (e.g. "sous zone 8")
  const mNum = t.match(/\b([1-9]|1[0-2])\b/);
  if (mNum) return toRoman(parseInt(mNum[1],10));

  return ""; // not found
}

let zoneNum   = extractZoneNum(zone);
let romanSZ   = extractSousZoneRomanOrNum(sousZone);

// If sousZone was empty but zone carried a parenthetical code like "... (080)", try from zone too.
if (!romanSZ) romanSZ = extractSousZoneRomanOrNum(zone);

let fao = "";
if (zoneNum && romanSZ) {
  fao = `FAO${zoneNum} ${romanSZ}`;
} else if (zoneNum) {
  fao = `FAO${zoneNum}`;
}

// Normalize what we store
zone = zone;                // keep original text for trace
sousZone = romanSZ || sousZone; // store roman if we found it




    /**************************************************
     * AF_MAP
     **************************************************/
    let keyMain = `${FOUR_CODE}__${ref}`.toUpperCase();
let keyAlt  = (FOUR_CODE === "81268")
  ? `81269__${ref}`.toUpperCase()
  : (FOUR_CODE === "81269")
    ? `81268__${ref}`.toUpperCase()
    : null;

let M = afMap[keyMain] || (keyAlt ? afMap[keyAlt] : null);


    let plu = (M?.plu ?? "").toString().trim();
    if (plu.endsWith(".0")) plu = plu.slice(0, -2);

    let designationInterne = M?.designationInterne || designation;
    let allergenes = M?.allergenes || "";

    /**************************************************
     * fallback Article
     **************************************************/
    if (!plu) {
      const designationStr = designation.toString().trim().toUpperCase();
      const art = Object.values(artMap).find(a =>
        (a.designation ?? "").toString().trim().toUpperCase() === designationStr
      );

      if (art) {
        plu = art.id || plu;
        if (art.zone) zone = art.zone;
        if (art.sousZone) sousZone = art.sousZone;
        if (art.engin) engin = art.engin;
      }
    }

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
      sousZone: _sousZone,
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

  if (missingRefs.length > 0) {
    console.log("🔎 Missing refs:", missingRefs);
    await manageAFMap(missingRefs);
  }
}

/**************************************************
 * ENTRY — PLU en colonne A
 **************************************************/
export async function importCrieePLUcolA(file, supplierCode) {
  const FOUR_CODE = supplierCode;

  const afMap    = await loadAFMap();
  const artMap   = await loadArticlesMap();
  const supplier = await loadSupplierInfo(FOUR_CODE);

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);

  await saveLines({
    achatId,
    rows,
    afMap,
    artMap,
    FOUR_CODE,
    colPLU:        0,
    colDesignation:1,
    colNomLatin:   2,
    colPrixKg:     6,
    colPoidsKg:    7,
    colMontantHT:  8,
    colZone:       10,
    colSousZone:   11,
    colEngin:      12,
  });

  alert("✅ Import Criée PLU colonne A — OK");
  location.reload();
}

/**************************************************
 * ENTRY — PLU en colonne B
 **************************************************/
export async function importCrieePLUcolB(file, supplierCode) {
  const FOUR_CODE = supplierCode;

  const afMap    = await loadAFMap();
  const artMap   = await loadArticlesMap();
  const supplier = await loadSupplierInfo(FOUR_CODE);

  const wb = await readWorkbookAsync(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const achatId = await createAchatHeader(supplier);

  await saveLines({
    achatId,
    rows,
    afMap,
    artMap,
    FOUR_CODE,
    colPLU:        1,
    colDesignation:2,
    colNomLatin:   3,
    colPrixKg:     7,
    colPoidsKg:    8,
    colMontantHT:  9,
    colZone:       12,
    colSousZone:   13,
    colEngin:      14,
  });

  alert("✅ Import Criée PLU colonne B — OK");
  location.reload();
}
