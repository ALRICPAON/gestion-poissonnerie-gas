/**************************************************
 * IMPORT SOGELMER (20006)
 * ✅ Version initiale – 13/11/2025
 * Inspiré de Royale Marée – parsing adapté au PDF 511-00074112
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * 🔎 Recherche AF_MAP — tolère zéros supprimés
 **************************************************/
function findAFMapEntry(afMap, fourCode, refFournisseur) {
  if (!refFournisseur) return null;
  const refStr = refFournisseur.toString().trim();
  const keyExact  = `${fourCode}__${refStr}`.toUpperCase();
  const keyNoZero = `${fourCode}__${refStr.replace(/^0+/, "")}`.toUpperCase();
  const keyPad    = `${fourCode}__${refStr.padStart(5, "0")}`.toUpperCase();
  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPad] || null;
}

/**************************************************
 * 🪝 Normalisation automatique des engins
 **************************************************/
function normalizeEngin(raw) {
  if (!raw) return "";
  const e = raw.toUpperCase().trim();
  if (e.includes("FILMAIL")) return "FILET MAILLANT";
  if (e.includes("FILTS")) return "FILET TOURNANT";
  if (e.includes("CHALUT")) return "CHALUT";
  if (e.includes("LIGNE")) return "LIGNE";
  return raw.trim();
}

/**************************************************
 * 🧩 FAO normalisé (y compris élevage)
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  const isElev = zone.normalize("NFD").replace(/\p{Diacritic}/gu,"").toUpperCase().startsWith("ELEV");
  if (isElev) return ("ÉLEVAGE" + (sousZone ? " " + sousZone.toUpperCase() : "")).trim();
  let z = zone.toUpperCase().replace(/^FAO\s*/, "FAO").replace(/^FAO(\d+)/, "FAO $1").trim();
  let sz = (sousZone || "").toUpperCase().replace(/\./g, "").trim();
  return (z + (sz ? " " + sz : "")).trim().replace(/\s{2,}/g, " ");
}

/**************************************************
 * 📄 Extraction texte PDF
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) {
    throw new Error("PDF.js non chargé. Ajoute <script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'>");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str);
    fullText += strings.join("\n") + "\n";
  }
  console.log("🔍 PDF brut (aperçu avec \\n):", fullText.slice(0, 1000));
  return fullText;
}

/**************************************************
 * 🧠 Parse du PDF SOGELMER
 **************************************************/
function parseSogelmerLines(text) {
  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0);

  let current = null;
  const isRef = s => /^[A-Z0-9]{4,10}$/.test(s);
  const isNum = s => /^[\d]+(?:,\d+)?$/.test(s);
  const isPrice = s => /€/.test(s);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // 📦 Nouvelle ligne article
    if (isRef(raw) && !raw.startsWith("Page") && !raw.startsWith("Total")) {
      if (current) rows.push(current);
      current = {
        refFournisseur: raw,
        designation: "",
        nomLatin: "",
        colis: 0,
        poidsColisKg: 0,
        poidsTotalKg: 0,
        prixKg: 0,
        montantHT: 0,
        lot: "",
        zone: "",
        sousZone: "",
        engin: "",
        fao: ""
      };
      // Désignation sur la ligne suivante
      if (lines[i + 1]) current.designation = lines[i + 1].replace(/\s+€/g, "").trim();
      continue;
    }

    if (!current) continue;

    // Colis / poids / montant
    if (/^Colis/i.test(raw)) {
      const parts = raw.split(/\s+/);
      const nums = parts.filter(p => /^[0-9]+(?:,[0-9]+)?$/.test(p));
      if (nums.length >= 3) {
        current.colis = parseInt(nums[0]);
        current.poidsColisKg = parseFloat(nums[1].replace(",", "."));
        current.poidsTotalKg = parseFloat(nums[2].replace(",", "."));
      }
    }

    // Prix et Montant
    if (isPrice(raw)) {
      const p = raw.match(/([\d]+,[\d]+)/g);
      if (p && p.length >= 2) {
        current.prixKg = parseFloat(p[0].replace(",", "."));
        current.montantHT = parseFloat(p[1].replace(",", "."));
      }
    }

    // Lot
    if (/Lot/i.test(raw)) {
      const m = raw.match(/Lot\s*:?([A-Z0-9\-]+)/i);
      if (m) current.lot = m[1].trim();
    }

    // Nom latin + FAO + Engin
    if (/FAO/i.test(raw)) {
      const latin = raw.split("-")[0].trim();
      current.nomLatin = latin;
      const faoMatch = raw.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
      if (faoMatch) {
        current.zone = `FAO${faoMatch[1]}`;
        current.sousZone = faoMatch[2].toUpperCase();
        current.fao = buildFAO(current.zone, current.sousZone);
      }
      const enginMatch = raw.match(/(Chalut|Ligne|Filet|Filmail|Filts)/i);
      if (enginMatch) current.engin = normalizeEngin(enginMatch[1]);
    }
  }

  if (current) rows.push(current);
  const cleaned = rows.filter(r => r.refFournisseur && r.designation);

  console.log("📦 Nombre d'articles trouvés:", cleaned.length);
  console.log("🧾 Lignes extraites:", cleaned);
  return cleaned;
}

/**************************************************
 * 💾 Sauvegarde Firestore (AF_MAP + Articles)
 **************************************************/
async function saveSogelmer(lines) {
  if (!lines.length) throw new Error("Aucune ligne trouvée dans le PDF.");
  const FOUR_CODE = "20006";
  const supplier = { code: FOUR_CODE, nom: "SOGELMER" };

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

  for (const L of lines) {
    totalHT += Number(L.montantHT || 0);
    totalKg  += Number(L.poidsTotalKg || 0);

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);
    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = normalizeEngin(L.engin);
    let fao = L.fao;
    let cleanFromAF = "";

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
      if (!engin && M.engin) engin = normalizeEngin(M.engin);
      if (!fao) fao = buildFAO(zone, sousZone);
    }

    const art = plu ? artMap[plu] : null;
    if (art) {
      if (!cleanFromAF) {
        const artDesignation = (art.Designation || art.designation || "").trim();
        if (artDesignation) {
          L.designation = artDesignation;
          designationInterne = artDesignation;
        }
      }
      if (!L.nomLatin || /total/i.test(L.nomLatin)) {
        L.nomLatin = (art.NomLatin || art.nomLatin || L.nomLatin || "").trim();
      }
      if (!zone && (art.Zone || art.zone)) zone = (art.Zone || art.zone);
      if (!sousZone && (art.SousZone || art.sousZone)) sousZone = (art.SousZone || art.sousZone);
      if (!engin && (art.Engin || art.engin)) engin = normalizeEngin(art.Engin || art.engin);
      if (!fao) fao = buildFAO(zone, sousZone);
    }

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      designation: L.designation,
      nomLatin: L.nomLatin,
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
      designationInterne,
      allergenes,
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
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

  alert(`✅ ${lines.length} lignes importées pour SOGELMER`);
  location.reload();
}

/**************************************************
 * 🧾 Entrée principale
 **************************************************/
export async function importSogelmer(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseSogelmerLines(text);
  await saveSogelmer(lines);
}
