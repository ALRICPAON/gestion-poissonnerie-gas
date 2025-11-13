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
  const lines = text.split(/\n|(?=\d{5}\s)/).map(l => l.trim()).filter(Boolean);

  let current = null;

  for (const raw of lines) {
    // 👉 Nouvelle ligne de produit si code article détecté (5 chiffres)
    if (/^\d{5}$/.test(raw)) {
      if (current) rows.push(current);
      current = {
        refFournisseur: raw,
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
    const l = raw.replace(/\s+/g, " ").trim();

    // 🧠 Lecture champs typiques
    if (/FAO\s*27/i.test(l)) current.zone = "FAO27";
    if (/FAO\s*37/i.test(l)) current.zone = "FAO37";
    if (/VIII|IX|IV|V|VI|VII|II/i.test(l) && !current.sousZone)
      current.sousZone = l.match(/VIII|IX|IV|V|VI|VII|II/i)?.[0] || "";

    if (/ÉLEVAGE|ELEVAGE/i.test(l)) {
      current.zone = "ÉLEVAGE";
      current.fao = "ÉLEVAGE";
    }

    if (/Engin\s*:/i.test(l))
      current.engin = l.replace(/.*Engin\s*:\s*/i, "").trim();

    if (/N°\s*Lot\s*:/i.test(l))
      current.lot = l.replace(/.*N°\s*Lot\s*:\s*/i, "").trim();

    if (/Gadus|Lophius|Pegusa|Salmo|Solea|Pleuronectes|Merluccius/i.test(l))
      current.nomLatin = l;

    // désignation
    if (/^[A-Z].*\d/.test(l) && !/FAO|Engin|Lot|ELEVAGE/i.test(l))
      current.designation += (current.designation ? " " : "") + l;

    // poids et prix
    if (/[,\.]\d{2,}/.test(l)) {
      const nums = l.match(/[\d,\.]+/g);
      if (nums?.length >= 3) {
        current.colis = parseFloat(nums[0].replace(",", ".")) || 0;
        current.poidsColisKg = parseFloat(nums[1].replace(",", ".")) || 0;
        current.montantHT = parseFloat(nums[2].replace(",", ".")) || 0;
      }
    }
  }

  // 🧩 Pousser le dernier produit
  if (current) rows.push(current);

  // 🧹 Nettoyage
  const cleaned = rows.filter(
    r =>
      r.refFournisseur &&
      r.designation &&
      r.designation.length > 3 &&
      !["0008", "85350", "85100", "44360"].includes(r.refFournisseur)
  );

  // 🧽 Nettoyage fin (EAN / Pavillon France / Total)
  for (const r of cleaned) {
    const idx = r.designation.search(/total|ean13|pavillon/i);
    if (idx > 0) r.designation = r.designation.slice(0, idx).trim();
    if (/total/i.test(r.nomLatin)) r.nomLatin = "";
  }

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

/**************************************************
 * 📂 Gestion du fichier uploadé
 **************************************************/
document.getElementById("import-pdf").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return alert("Aucun fichier sélectionné.");

  const arrayBuffer = await file.arrayBuffer();
  const user = firebase.auth().currentUser;
  if (!user) return alert("Utilisateur non connecté.");

  try {
    const lignes = await parseRoyaleMareePDF(arrayBuffer);
    if (!lignes || !lignes.length) throw new Error("Aucune ligne trouvée dans le PDF.");
    await saveRoyaleMaree(lignes, user);
  } catch (err) {
    console.error(err);
    alert("❌ Erreur import : " + err.message);
  }
});
