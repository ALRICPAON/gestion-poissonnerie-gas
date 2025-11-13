/**************************************************
 * IMPORT ROYALE MARÉE (10004)
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * 🔍 Lecture du PDF et extraction
 **************************************************/
async function parseRoyaleMareePDF(pdfData) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js";

  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  let textContent = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    textContent += content.items.map(it => it.str).join(" ") + "\n";
  }

  console.log("🔍 PDF brut (aperçu avec \\n):", textContent.slice(0, 1000));
  return parseRoyaleMareeLines(textContent);
}

/**************************************************
 * 🧩 Extraction ligne par ligne
 **************************************************/
function parseRoyaleMareeLines(text) {
  const rows = [];
  let current = null;

  // 1️⃣ Nettoyage du texte brut
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const l = line.replace(/\s+/g, " ").trim();

    // 🆕 Détecter une nouvelle ligne produit (5 chiffres en début de ligne)
    const codeMatch = l.match(/^(\d{5})\b/);
    if (codeMatch) {
      if (current) rows.push(current);
      current = {
        refFournisseur: codeMatch[1],
        designation: "",
        nomLatin: "",
        engin: "",
        zone: "",
        sousZone: "",
        fao: "",
        lot: "",
        poidsColisKg: 0,
        poidsTotalKg: 0,
        prixKg: 0,
        montantHT: 0,
        colis: 0
      };
      continue;
    }

    if (!current) continue;

    // 🧠 Extraction de données
    if (/FAO\s*27/i.test(l)) current.zone = "FAO27";
    if (/VIII|IX|IV|V|VI|VII|II/i.test(l) && !current.sousZone)
      current.sousZone = l.match(/VIII|IX|IV|V|VI|VII|II/i)?.[0] || "";
    if (/ELEVAGE|ÉLEVAGE/i.test(l)) current.zone = "ÉLEVAGE";
    if (/Engin\s*:/i.test(l)) current.engin = l.replace(/.*Engin\s*:\s*/i, "").trim();
    if (/Lot\s*:/i.test(l)) current.lot = l.replace(/.*Lot\s*:\s*/i, "").trim();
    if (/Gadus|Salmo|Pegusa|Lophius|Solea|Pleuronectes/i.test(l))
      current.nomLatin = l.trim();
    if (/^[A-Z].*/.test(l) && !/FAO|Engin|Lot|ELEVAGE|ÉLEVAGE/i.test(l))
      current.designation += (current.designation ? " " : "") + l;

    // Poids, prix, montant
    const poids = l.match(/(\d+,\d+).+?(\d+,\d+).+?(\d+,\d+)/);
    if (poids) {
      const [_, a, b, c] = poids;
      current.colis = parseFloat(a.replace(",", ".")) || 0;
      current.poidsColisKg = parseFloat(b.replace(",", ".")) || 0;
      current.montantHT = parseFloat(c.replace(",", ".")) || 0;
    }
  }

  // 2️⃣ Pousser le dernier bloc
  if (current) rows.push(current);

  // 3️⃣ Nettoyage : supprimer en-têtes et lignes vides
  const cleaned = rows.filter(
    r =>
      r.refFournisseur &&
      r.designation &&
      r.designation.length > 3 &&
      !["0008", "85350", "85100", "44360"].includes(r.refFournisseur)
  );

  console.log("📦 Nombre d'articles trouvés (après nettoyage):", cleaned.length);
  console.log("🧾 Lignes extraites:", cleaned);
  return cleaned;
}

/**************************************************
 * 💾 Enregistrement Firestore
 **************************************************/
async function saveRoyaleMaree(lignes, user) {
  const achatsRef = collection(db, "achats", user.uid, "lignes");

  // 🔹 Charger la base articles pour compléter designation / nomLatin
  const snap = await getDocs(collection(db, "articles"));
  const articlesMap = {};
  snap.forEach(d => {
    const art = d.data();
    if (art.plu) articlesMap[art.plu] = art;
  });

  let count = 0;
  for (const l of lignes) {
    try {
      // 🧹 Nettoyage complémentaire
      l.designation = l.designation
        .replace(/\/?\s*Ean13.*$/i, "")
        .replace(/total.*$/i, "")
        .replace(/pavillon.*$/i, "")
        .trim();
      l.nomLatin = l.nomLatin.replace(/total.*$/i, "").trim();

      // 🔄 Compléter depuis la fiche article
      const art = articlesMap[l.plu];
      if (art) {
        if (!l.designationInterne)
          l.designationInterne = art.designationInterne || art.designation || "";
        if (!l.designation || l.designation.length < 4)
          l.designation = art.designation || l.designation;
        if (!l.nomLatin) l.nomLatin = art.nomLatin || "";
      }

      // 🚫 Supprimer qr_url
      delete l.qr_url;

      // 🕒 Timestamps
      l.createdAt = serverTimestamp();
      l.updatedAt = serverTimestamp();

      await addDoc(achatsRef, l);
      count++;
    } catch (err) {
      console.error("Erreur Firestore pour", l, err);
    }
  }

  console.log(`✅ Import terminé : ${count} lignes ajoutées.`);

  // 🔄 Rechargement automatique
  setTimeout(() => window.location.reload(), 800);
}

export async function importRoyaleMaree(file, user) {
  const arrayBuffer = await file.arrayBuffer();
  const lignes = await parseRoyaleMareePDF(arrayBuffer);
  if (!lignes.length) throw new Error("Aucune ligne trouvée dans le PDF.");
  await saveRoyaleMaree(lignes, user);
}

