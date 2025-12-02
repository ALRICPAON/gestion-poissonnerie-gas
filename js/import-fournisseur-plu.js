// js/import-fournisseur-plu.js
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, serverTimestamp, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* helpers */
function toNum(x){
  if (x == null || x === "") return 0;
  const s = String(x).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUnit(u){
  if (!u) return "kg";
  const s = String(u).trim().toLowerCase();
  if (s.startsWith("k") || s.includes("kg") || s.includes("kil")) return "kg";
  if (s.startsWith("p") || s.includes("piè") || s.includes("pi") || s.includes("pc") || s.includes("pcs")) return "piece";
  if (s === "pcs" || s === "pc") return "piece";
  return s;
}

/**
 * importFournisseurPlu(file, fournisseurCode)
 * Format attendu (col index 0..):
 * 0: PLU
 * 1: designation
 * 2: nbre colis
 * 3: poids colis
 * 4: total poids
 * 5: prix
 * 6: nom latin
 * 7: methode
 * 8: zone
 * 9: engin
 * 10: vide
 * 11: allergens
 * 12: unite (kg|piece)
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

  // 2) détecte un header ligne 1 (si contient 'plu' ou 'designation' etc.)
  let startRow = 0;
  const firstRow = (rows[0] || []).map(c => (c||"").toString().toLowerCase());
  if (firstRow.some(c => /plu|designation|prix|unite|allerg/i.test(c))) startRow = 1;

  // 3) charger map articles (plu -> article)
  const artSnap = await getDocs(collection(db, "articles"));
  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[String(a.plu).trim()] = a;
  });

  // 4) chercher nom fournisseur si connu
  let fournisseurNom = String(fournisseurCode);
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

  // 6) parcourir lignes et sauver
  let totalHT = 0;
  let totalKg = 0;
  const missingPlu = [];

  for (let r = startRow; r < rows.length; r++){
    const row = rows[r] || [];
    // ignorer lignes vides
    if (row.every(c => c === undefined || c === null || String(c).trim() === "")) continue;

    const rawPlu = row[0];
    if (rawPlu == null || String(rawPlu).trim() === "") continue;
    const plu = String(rawPlu).trim().replace(/\.0$/, "");
    const designationF = (row[1] || "").toString().trim();
    const nbreColis = toNum(row[2]);
    const poidsColis = toNum(row[3]);
    let totalPoids = toNum(row[4]);
    const prix = toNum(row[5]);
    const nomLatinF = (row[6] || "").toString().trim();
    const methode = (row[7] || "").toString().trim();
    const zone = (row[8] || "").toString().trim();
    const engin = (row[9] || "").toString().trim();
    const allergenes = (row[11] || "").toString().trim();
    const unite = normalizeUnit(row[12]);

    // si totalPoids absent, essayer nbreColis * poidsColis
    if (!totalPoids && nbreColis && poidsColis) totalPoids = nbreColis * poidsColis;

    // fiche article si existante
    const art = artMap[plu];
    const designation = art ? (art.Designation || art.designation || art.designationInterne || designationF) : designationF;
    const nomLatin = art ? (art.NomLatin || art.nomLatin || nomLatinF) : nomLatinF;

    // calculs selon unite
    let prixHTKg = 0;
    let prixUnite = 0;
    let montantHT = 0;

    if (unite === "kg") {
      prixHTKg = prix;
      montantHT = prix * (totalPoids || 0); // si totalPoids = 0, montantHT = 0
    } else if (unite === "piece") {
      prixUnite = prix;
      // Hypothèse : nbreColis == nombre d'unités ; si tu veux autre chose dis-le
      montantHT = prix * (nbreColis || 0);
    } else {
      // fallback: si nombre de colis > 0 on suppose piece sinon kg
      if (nbreColis > 0) {
        prixUnite = prix;
        montantHT = prix * nbreColis;
      } else {
        prixHTKg = prix;
        montantHT = prix * (totalPoids || 0);
      }
    }

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
      allergenes: allergenes || "",

      poidsKg: totalPoids || 0,
      poidsTotalKg: totalPoids || 0,
      poidsColisKg: poidsColis || 0,
      colis: nbreColis || 0,

      prixHTKg,
      prixKg: prixHTKg,
      prixUnite,
      unite,

      montantHT: montantHT || 0,
      montantTTC: montantHT || 0,

      received: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // enrichir à partir de la fiche article existante
    if (art) {
      if (!lineObj.nomLatin) lineObj.nomLatin = art.NomLatin || art.nomLatin || "";
      if (!lineObj.zone && (art.Zone || art.zone)) lineObj.zone = art.Zone || art.zone;
      if (!lineObj.sousZone && (art.SousZone || art.sousZone)) lineObj.sousZone = art.SousZone || art.sousZone;
      if (!lineObj.engin && (art.Engin || art.engin)) lineObj.engin = art.Engin || art.engin;
    }

    // sauvegarde
    await addDoc(collection(db, "achats", achatId, "lignes"), lineObj);

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

  // 8) log PLU manquants (option : ouvrir AF_MAP si tu veux)
  if (missingPlu.length > 0) {
    console.warn("PLU non trouvés dans articles:", [...new Set(missingPlu)].slice(0,50));
    // option : ouvrir la popup AF_MAP pour ces PLU si tu veux
  }

  // reload pour voir le nouvel achat
  setTimeout(() => location.reload(), 300);

  return { achatId };
}
