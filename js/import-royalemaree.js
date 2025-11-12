/**************************************************
 * IMPORT ROYALE MAREE (10004)
 * Lecture PDF texte et enregistrement Firestore
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, updateDoc,
  serverTimestamp, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * Charger AF_MAP et Articles
 **************************************************/
async function loadAFMap() {
  const snap = await getDocs(collection(db, "af_map"));
  const map = {};
  snap.forEach(d => {
    const data = d.data();
    const id = d.id.toUpperCase();
    if (id.startsWith("10004__")) map[id] = data;
  });
  return map;
}

async function loadArticlesMap() {
  const snap = await getDocs(collection(db, "articles"));
  const map = {};
  snap.forEach(d => (map[d.id] = d.data()));
  return map;
}

/**************************************************
 * Crée en-tête achat
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
 * Lecture texte PDF (pdf.js)
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str);
    text += strings.join(" ") + "\n";
  }
  return text;
}

/**************************************************
 * Conversion FAO → normalisé
 **************************************************/
function extractFAO(zoneTxt = "") {
  const match = zoneTxt.match(/FAO\s*([0-9]{1,3})\s*([IVX]+)/i);
  if (match) return `FAO${match[1]} ${match[2].toUpperCase()}`;
  return "";
}

/**************************************************
 * Parse lignes PDF texte
 **************************************************/
function parseRoyaleMareeText(text) {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.match(/^[0-9]{5}\s/)); // lignes commençant par code article

  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Exemple : "02872 3 3,000 21,00 9,00 189,00 DOS CABILLAUD 400+"
    const parts = l.split(/\s+/);
    if (parts.length < 6) continue;

    const refF = parts[0];
    const colis = parseFloat(parts[1].replace(",", "."));
    const poidsColis = parseFloat(parts[2].replace(",", "."));
    const prixKg = parseFloat(parts[3].replace(",", "."));
    const poidsTotal = parseFloat(parts[4].replace(",", "."));
    const montantHT = parseFloat(parts[5].replace(",", "."));
    const designation = parts.slice(6).join(" ");

    // Chercher lignes suivantes pour nom latin et zone
    let nomLatin = "", zone = "", engin = "", lot = "";
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      const next = lines[i + j];
      if (/^[A-Z]/.test(next) && !next.match(/FAO/)) break;
      if (/^[A-Z][a-z]+\s+[a-z]+/.test(next)) nomLatin = next;
      if (/FAO/.test(next)) zone = next;
      if (/Engin\s*:?/i.test(next)) engin = next.replace(/.*Engin\s*:?\s*/i, "");
      if (/Lot\s*:?/i.test(next)) lot = next.replace(/.*Lot\s*:?\s*/i, "");
    }

    const fao = extractFAO(zone);

    out.push({
      refFournisseur: refF,
      designation,
      nomLatin,
      zone,
      fao,
      engin,
      lot,
      colis,
      poidsColisKg: poidsColis,
      poidsTotalKg: poidsTotal,
      prixKg,
      montantHT,
    });
  }
  return out;
}

/**************************************************
 * Enregistrement Firestore
 **************************************************/
async function saveLines(achatId, lines, afMap, artMap, FOUR_CODE) {
  let totalHT = 0, totalKg = 0;
  const missingRefs = [];

  for (const r of lines) {
    const ref = r.refFournisseur;
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const M = afMap[key] || null;
    let plu = (M?.plu || "").toString().trim();
    if (plu.endsWith(".0")) plu = plu.slice(0, -2);

    if (!M?.plu) {
      missingRefs.push({ fournisseurCode: FOUR_CODE, refFournisseur: ref, designation: r.designation, achatId });
    }

    totalHT += r.montantHT;
    totalKg += r.poidsTotalKg;

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      fournisseurRef: ref,
      refFournisseur: ref,
      plu,
      designation: r.designation,
      nomLatin: r.nomLatin,
      zone: r.zone,
      fao: r.fao,
      engin: r.engin,
      lot: r.lot,
      poidsColisKg: r.poidsColisKg,
      poidsTotalKg: r.poidsTotalKg,
      prixKg: r.prixKg,
      montantHT: r.montantHT,
      montantTTC: r.montantHT,
      colis: r.colis,
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
    console.warn("❗ Missing refs", missingRefs);
    alert(`Attention : ${missingRefs.length} articles non trouvés dans AF_MAP`);
  }
}

/**************************************************
 * MAIN IMPORT FUNCTION
 **************************************************/
export async function importRoyaleMaree(file) {
  const FOUR_CODE = "10004";
  const supplier = { code: FOUR_CODE, nom: "ROYALE MAREE" };
  const afMap = await loadAFMap();
  const artMap = await loadArticlesMap();

  const text = await extractTextFromPdf(file);
  console.log("🔎 PDF brut:", text.slice(0, 3000));

  const rows = parseRoyaleMareeText(text);
  console.log("📄 Lignes détectées :", rows.length);

  const achatId = await createAchatHeader(supplier);
  await saveLines(achatId, rows, afMap, artMap, FOUR_CODE);

  alert("✅ Import Royale Marée terminé !");
  location.reload();
}
