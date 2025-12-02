// js/import-fournisseur-plu.js
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* helpers */
function toNum(x){
  if (x == null || x === "") return 0;
  return parseFloat(String(x).replace(",", ".").replace(/\s/g,"")) || 0;
}

function normalizeUnit(u){
  if (!u) return "kg";
  const s = String(u).trim().toLowerCase();
  if (s.startsWith("k")) return "kg";
  if (s.startsWith("p") || s.includes("pi")) return "piece";
  if (s === "pcs" || s === "pc") return "piece";
  return s;
}

/**
 * importFournisseurPlu(file, fournisseurCode)
 * - file: File (xlsx / csv)
 * - fournisseurCode: string (ex "10007" ou "81268")
 *
 * Format attendu (col index 0..):
 * 0: PLU
 * 1: designation
 * 2: nom latin
 * 3: methode de peche
 * 4: zone de peche
 * 5: engin de peche
 * 6: IGNORE
 * 7: allergene
 * 8: prix
 * 9: unite (kg|piece)
 */
export async function importFournisseurPlu(file, fournisseurCode){
  if (!file) throw new Error("Fichier manquant");
  if (!fournisseurCode) throw new Error("Code fournisseur manquant");

  // 1) lecture excel/csv premier onglet
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (!rows || rows.length === 0) throw new Error("Feuille vide");

  // 2) détection si première ligne est un header "PLU" etc. -> skip si oui
  let startRow = 0;
  const firstRow = (rows[0] || []).map(c => (c || "").toString().toLowerCase());
  if (firstRow.some(c => /plu|designation|nom latin|prix|unite|allergene/.test(c))) {
    startRow = 1;
  }

  // 3) préparer map articles si PLU correspond à fiche articles
  const artSnap = await getDocs(collection(db, "articles"));
  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[String(a.plu).trim()] = a;
  });

  // 4) récupérer nom fournisseur si présent dans collection "fournisseurs"
  let fournisseurNom = fournisseurCode;
  try {
    const fSnap = await getDocs(collection(db, "fournisseurs"));
    fSnap.forEach(d => {
      const f = d.data();
      const code = (f.Code || f.code || "").toString();
      if (code === String(fournisseurCode)) fournisseurNom = f.Nom || f.nom || fournisseurNom;
    });
  } catch(e){
    console.warn("Impossible de lire fournisseurs:", e.message);
  }

  // 5) créer achat
  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0,10),
    fournisseurCode: String(fournisseurCode),
    fournisseurNom,
    type: "commande",
    statut: "new",
    montantHT: 0,
    montantTTC: 0,
    totalKg: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const achatId = achatRef.id;

  // 6) parcourir les lignes
  let totalHT = 0;
  let totalKg = 0;
  const missingPlu = [];

  for (let r = startRow; r < rows.length; r++){
    const row = rows[r] || [];
    // ignore lines vide
    if (row.every(c => c === undefined || c === null || String(c).trim() === "")) continue;

    const rawPlu = row[0];
    if (rawPlu == null || String(rawPlu).trim() === "") continue; // on skip si pas de PLU

    const plu = String(rawPlu).trim().replace(/\.0$/, "");
    const designationF = (row[1] || "").toString().trim();
    const nomLatinF = (row[2] || "").toString().trim();
    const methode = (row[3] || "").toString().trim();
    const zone = (row[4] || "").toString().trim();
    const engin = (row[5] || "").toString().trim();
    const allergene = (row[7] || "").toString().trim();
    const prixRaw = row[8];
    const uniteRaw = row[9];

    const prix = toNum(prixRaw);
    const unite = normalizeUnit(uniteRaw);

    // chercher la fiche article si existante
    const art = artMap[plu];
    const designation = art ? (art.Designation || art.designation || art.designationInterne || designationF) : designationF;
    const nomLatin = art ? (art.NomLatin || art.nomLatin || nomLatinF) : nomLatinF;

    // construire objet ligne
    // NOTE: le fichier ne contient pas de quantité, on crée la ligne avec poids = 0,
    // on met le prix dans prixHTKg si unite == 'kg', sinon dans prixUnite si 'piece'.
    const poidsKg = 0;
    const poidsTotalKg = 0;

    const prixHTKg = (unite === "kg") ? prix : 0;
    const prixUnite = (unite === "piece") ? prix : 0;

    // montantHT : si unité piece -> on met le prix comme montant HT (équivalent quantité 1).
    // si kg sans quantité, on laisse montantHT = 0 (prix par kg renseigné pour usage futur).
    const montantHT = (unite === "piece") ? prix : 0;

    const lineObj = {
      refFournisseur: plu,
      fournisseurRef: plu,

      plu,
      designation: designation || "",
      designationInterne: designation || "",
      nomLatin: nomLatin || "",

      methodePeche: methode || "",
      zone: zone || "",
      sousZone: "",

      engin: engin || "",
      allergenes: allergene || "",

      poidsKg,
      poidsTotalKg,
      prixHTKg,
      prixKg: prixHTKg,
      prixUnite,
      unite,

      montantHT,
      montantTTC: montantHT,

      colis: 0,
      poidsColisKg: 0,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Enrichir depuis fiche article si besoin (zone/engin, etc.)
    if (art) {
      if (!lineObj.nomLatin) lineObj.nomLatin = art.NomLatin || art.nomLatin || "";
      if (!lineObj.zone && (art.Zone || art.zone)) lineObj.zone = art.Zone || art.zone;
      if (!lineObj.sousZone && (art.SousZone || art.sousZone)) lineObj.sousZone = art.SousZone || art.sousZone;
      if (!lineObj.engin && (art.Engin || art.engin)) lineObj.engin = art.Engin || art.engin;
    }

    // save ligne
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), lineObj);

    // totals
    totalHT += Number(lineObj.montantHT || 0);
    totalKg += Number(lineObj.poidsTotalKg || 0);

    if (!art) missingPlu.push(plu);
  }

  // 7) maj achat totals
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT,
    totalKg,
    updatedAt: serverTimestamp()
  });

  // 8) si PLU manquants -> log (on peut aussi déclencher AF_MAP si tu veux)
  if (missingPlu.length > 0){
    console.warn("PLU non trouvés dans articles:", [...new Set(missingPlu)].slice(0,50));
    // option: ouvrir popup AF_MAP pour les PLU manquants
  }

  // reload pour voir le nouvel achat
  setTimeout(() => location.reload(), 300);

  return { achatId };
}
