/**************************************************
 * IMPORT ROYALE MAREE (10004)
 *  Version FINALE — Stable + Popup AF_MAP + Patch PLU
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp,
  updateDoc, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * AF_MAP — Recherche intelligente
 **************************************************/
function findAFMapEntry(afMap, fourCode, ref) {
  if (!ref) return null;
  const clean = ref.toString().trim().toUpperCase();

  const keyExact  = `${fourCode}__${clean}`;
  const keyNoZero = `${fourCode}__${clean.replace(/^0+/, "")}`;
  const keyPad    = `${fourCode}__${clean.padStart(5, "0")}`;

  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPad] || null;
}

/**************************************************
 * Normalisation FAO
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";

  const isElev = zone.normalize("NFD").replace(/\p{Diacritic}/gu,"").toUpperCase().startsWith("ELEV");
  if (isElev) return ("ÉLEVAGE " + (sousZone || "")).trim();

  const z = "FAO " + zone.replace(/FAO/i, "").trim();
  return (z + " " + (sousZone || "")).trim();
}

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
 * Parse PDF Royale Marée
 **************************************************/
function parseRoyaleMareeLines(text) {
  const rows = [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  let current = null;
  let stage = 0;

  const isCode  = s => /^\d{4,5}$/.test(s);
  const isInt   = s => /^\d+$/.test(s);
  const isNum   = s => /^[\d]+(?:,\d+)?$/.test(s);
  const isLatin = s => /^[A-Z][a-z]+(?: [A-Za-z]+)*$/.test(s);

  const pushCurrent = () => {
    if (current) {
      if (!current.fao) current.fao = buildFAO(current.zone, current.sousZone);
      rows.push(current);
    }
    current = null;
    stage = 0;
  };

  for (let raw of lines) {
    if (isCode(raw)) {
      pushCurrent();
      current = {
        refFournisseur: raw,
        designation: "",
        nomLatin: "",
        colis: 0,
        poidsColisKg: 0,
        prixKg: 0,
        montantHT: 0,
        poidsTotalKg: 0,
        zone: "",
        sousZone: "",
        engin: "",
        lot: "",
        fao: ""
      };
      stage = 1;
      continue;
    }

    if (!current) continue;

    if (stage === 1 && isInt(raw)) { current.colis = parseInt(raw); stage=2; continue; }
    if (stage === 2 && isNum(raw)) { current.poidsColisKg = parseFloat(raw.replace(",", ".")); stage=3; continue; }
    if (stage === 3 && isNum(raw)) { current.montantHT   = parseFloat(raw.replace(",", ".")); stage=4; continue; }
    if (stage === 4 && isNum(raw)) { current.prixKg       = parseFloat(raw.replace(",", ".")); stage=5; continue; }
    if (stage === 5 && isNum(raw)) { current.poidsTotalKg = parseFloat(raw.replace(",", ".")); stage=6; continue; }

    // designation + latin
    if (stage >= 6 && !raw.startsWith("|")) {
      if (/total|établissement|bon/i.test(raw)) continue;

      if (isLatin(raw)) {
        current.nomLatin = raw;
        if (!current.designation.includes(raw)) {
          current.designation = (current.designation + " " + raw).trim();
        }
        continue;
      }

      if (!isCode(raw)) {
        current.designation = (current.designation + " " + raw).trim();
        continue;
      }
    }

    // Meta : FAO / Engin / Lot
    if (raw.startsWith("|")) {
      if (/FAO/i.test(raw)) {
        const m = raw.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
        if (m) {
          current.zone = m[1];
          current.sousZone = m[2] || "";
          current.fao = buildFAO(current.zone, current.sousZone);
        }
      }
      if (/Engin/i.test(raw)) {
        const m = raw.match(/Engin\s*:\s*(.*)/i);
        if (m) current.engin = m[1].trim();
      }
      if (/Lot/i.test(raw)) {
        const m = raw.match(/Lot\s*:\s*(.*)/i);
        if (m) current.lot = m[1].trim();
      }
      continue;
    }
  }

  if (current) rows.push(current);
  return rows;
}

/**************************************************
 * SAVE ROYALE MAREE
 **************************************************/
async function saveRoyaleMaree(lines) {
  const FOUR_CODE = "10004";

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => afMap[d.id.toUpperCase()] = d.data());

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString().trim()] = a;
  });

  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0,10),
    fournisseurCode: FOUR_CODE,
    fournisseurNom: "Royale Marée",
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
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;

    /**************************************************
     * AF_MAP PRIORITY
     **************************************************/
    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    if (M) {
      plu = (M.plu || "").toString().trim().replace(/\.0$/, "");

      cleanFromAF = (M.designationInterne || M.aliasFournisseur || "").trim();
      if (cleanFromAF) {
        designationInterne = cleanFromAF;
        L.designation = cleanFromAF;
      }

      if (!zone && M.zone) zone = M.zone;
      if (!sousZone && M.sousZone) sousZone = M.sousZone;
      if (!engin && M.engin) engin = M.engin;
      if (!fao) fao = buildFAO(zone, sousZone);

    } else {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation,
        designationInterne,
        aliasFournisseur: L.designation,
        nomLatin: L.nomLatin,
        zone,
        sousZone,
        engin,
        allergenes: "",
        achatId,
        lineId: null
      });
    }

    /**************************************************
     * ART Fallback
     **************************************************/
    if (plu && artMap[plu] && !cleanFromAF) {
      const art = artMap[plu];

      const artDesignation = (art.Designation || art.designation || "").trim();
      if (artDesignation) {
        designationInterne = artDesignation;
        L.designation = artDesignation;
      }

      if (!zone && art.Zone) zone = art.Zone;
      if (!sousZone && art.SousZone) sousZone = art.SousZone;
      if (!engin && art.Engin) engin = art.Engin;
      if (!fao) fao = buildFAO(zone, sousZone);
    }

    /**************************************************
     * ENREGISTRE LA LIGNE
     **************************************************/
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      designation: L.designation,
      designationInterne,
      nomLatin: L.nomLatin || "",
      colis: L.colis,
      poidsColisKg: L.poidsColisKg,
      poidsTotalKg: L.poidsTotalKg,
      prixKg: L.prixKg,
      montantHT: L.montantHT,
      zone,
      sousZone,
      engin,
      lot: L.lot || "",
      fao,
      plu,
      allergenes: "",
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Injecter lineId pour le popup
    missingRefs.forEach(ref => {
      if (ref.refFournisseur === L.refFournisseur && ref.lineId === null) {
        ref.lineId = lineRef.id;
      }
    });

    /**************************************************
     * PATCH AUTO (après popup)
     **************************************************/
    if (!M) {
      const refKey = (`10004__${L.refFournisseur}`).toUpperCase();

      setTimeout(async () => {
        const snap = await getDoc(doc(db, "af_map", refKey));
        if (!snap.exists()) return;
        const mapped = snap.data();

        await updateDoc(doc(db, "achats", achatId, "lignes", lineRef.id), {
          plu: mapped.plu || "",
          designationInterne: mapped.designationInterne || "",
          designation: mapped.designationInterne || "",
          updatedAt: serverTimestamp()
        });

        console.log("🔄 Ligne Royale Marée mise à jour après AF_MAP :", lineRef.id);
      }, 500);
    }
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: Number(totalHT.toFixed(2)),
    montantTTC: Number(totalHT.toFixed(2)),
    totalKg: Number(totalKg.toFixed(3)),
    updatedAt: serverTimestamp()
  });

  /**************************************************
   * POPUP OU RELOAD
   **************************************************/
  if (missingRefs.length > 0) {
    const { manageAFMap } = await import("./manage-af-map.js");
    await manageAFMap(missingRefs);
  } else {
    alert(`✅ ${lines.length} lignes importées (Royale Marée)`);
    location.reload();
  }
}

/**************************************************
 * Entrée
 **************************************************/
export async function importRoyaleMaree(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseRoyaleMareeLines(text);
  await saveRoyaleMaree(lines);
}
