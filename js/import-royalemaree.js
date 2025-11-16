/**************************************************
 * IMPORT ROYALE MAREE (10004)
 * ✅ Version stable + popup AF_MAP – 17/11/2025
 **************************************************/
import { db } from "../js/firebase-init.js";
import {
  collection,
  addDoc,
  doc,
  serverTimestamp,
  updateDoc,
  getDocs
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
 * 🧩 FAO normalisé (y compris élevage)
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  const isElev = zone
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .startsWith("ELEV");
  if (isElev) {
    return ("ÉLEVAGE" + (sousZone ? " " + sousZone.toUpperCase() : "")).trim();
  }

  let z = zone
    .toUpperCase()
    .replace(/^FAO\s*/, "FAO")
    .replace(/^FAO(\d+)/, "FAO $1")
    .trim();

  let sz = (sousZone || "")
    .toUpperCase()
    .replace(/\./g, "")
    .trim();

  return (z + (sz ? " " + sz : "")).trim().replace(/\s{2,}/g, " ");
}

/**************************************************
 * 📄 Extraction texte PDF
 **************************************************/
async function extractTextFromPdf(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) {
    throw new Error(
      "PDF.js non chargé. Ajoute <script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'>"
    );
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
 * 🧠 Parse du PDF Royale Marée
 **************************************************/
function parseRoyaleMareeLines(text) {
  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0);

  let current = null;
  let stage = 0;

  const isCode  = s => /^\d{4,5}$/.test(s);
  const isInt   = s => /^\d+$/.test(s);
  const isNum   = s => /^[\d]+(?:,\d+)?$/.test(s);
  const isLatin = s =>
    /^[A-Z][a-z]+(?:\s+[A-Za-z]+){1,2}(?:\s+[A-Z]{2,5})?$/.test(s);

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
        colis: 0,
        poidsColisKg: 0,
        montantHT: 0,
        prixKg: 0,
        poidsTotalKg: 0,
        designation: "",
        nomLatin: "",
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

    if (stage === 1 && isInt(raw)) {
      current.colis = parseInt(raw, 10);
      stage = 2;
      continue;
    }
    if (stage === 2 && isNum(raw)) {
      current.poidsColisKg = parseFloat(raw.replace(",", "."));
      stage = 3;
      continue;
    }
    if (stage === 3 && isNum(raw)) {
      current.montantHT = parseFloat(raw.replace(",", "."));
      stage = 4;
      continue;
    }
    if (stage === 4 && isNum(raw)) {
      current.prixKg = parseFloat(raw.replace(",", "."));
      stage = 5;
      continue;
    }
    if (stage === 5 && isNum(raw)) {
      current.poidsTotalKg = parseFloat(raw.replace(",", "."));
      stage = 6;
      continue;
    }

    if (stage >= 6 && !raw.startsWith("|")) {
      // 🚫 Ignore les lignes de fin comme "Total Bon", "Total Etablissement"
      if (/total|bon|établissement|etablissement/i.test(raw)) continue;

      if (isLatin(raw)) {
        current.nomLatin = raw;
        if (!current.designation.toLowerCase().includes(raw.toLowerCase())) {
          current.designation = (current.designation + " " + raw).trim();
        }
        continue;
      } else if (!isCode(raw)) {
        current.designation = (current.designation + " " + raw).trim();
        continue;
      }
    }

    if (raw.startsWith("|")) {
      if (/FAO/i.test(raw) || /Pêché/i.test(raw) || /Elevé/i.test(raw)) {
        const allFAO = [...raw.matchAll(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/gi)];
        if (allFAO.length) {
          const last = allFAO[allFAO.length - 1];
          current.zone = `FAO${last[1]}`;
          current.sousZone = last[2]
            ? last[2].toUpperCase().replace(/\./g, "")
            : "";
          current.fao = buildFAO(current.zone, current.sousZone);
        }
        if (/Elevé/i.test(raw)) {
          current.zone = "ÉLEVAGE";
          const m = raw.match(/Elevé.+?en\s*:?\s*([^|]+)/i);
          if (m) current.sousZone = (m[1] || "").trim().toUpperCase();
          current.fao = buildFAO(current.zone, current.sousZone);
        }
      }
      if (/Engin/i.test(raw)) {
        const m = raw.match(/Engin\s*:\s*([^|]+)/i);
        if (m) current.engin = m[1].trim();
      }
      if (/Lot/i.test(raw)) {
        const m = raw.match(/Lot\s*:\s*([A-Za-z0-9\-]+)/i);
        if (m) current.lot = m[1].trim();
      }
      continue;
    }
  }

  // 🧩 Fix final : pousse le dernier article
  if (current) rows.push(current);

  // 🧹 Nettoyage final
  const cleaned = rows.filter(
    r =>
      r.refFournisseur &&
      r.designation &&
      r.designation.length > 3 &&
      !["0008", "85350", "85100", "44360"].includes(r.refFournisseur)
  );

  // Supprime les fins type "Total Bon"
  for (const r of cleaned) {
    const idx = r.designation.search(/total/i);
    if (idx > 0) r.designation = r.designation.slice(0, idx).trim();
  }

  console.log("📦 Nombre d'articles trouvés (après nettoyage):", cleaned.length);
  console.log("🧾 Lignes extraites:", cleaned);

  return cleaned;
}

/**************************************************
 * 💾 Sauvegarde Firestore (avec AF_MAP + Articles + popup)
 **************************************************/
async function saveRoyaleMaree(lines) {
  if (!lines.length) throw new Error("Aucune ligne trouvée dans le PDF.");
  const FOUR_CODE = "10004";
  const supplier = { code: FOUR_CODE, nom: "Royale Marée" };

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => {
    afMap[d.id.toUpperCase()] = d.data();
  });

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
    updatedAt: serverTimestamp()
  });

  const achatId = achatRef.id;
  let totalHT = 0;
  let totalKg = 0;

  /** 🔎 Références sans AF_MAP : on stocke tout comme pour SOGELMER */
  const missingRefs = [];

  for (const L of lines) {
    totalHT += Number(L.montantHT || 0);
    totalKg += Number(L.poidsTotalKg || 0);

    // ---------- mapping vars ----------
    let plu = "";
    let designationInterne = L.designation;
    let allergenes = "";
    let zone = L.zone;
    let sousZone = L.sousZone;
    let engin = L.engin;
    let fao = L.fao;
    let cleanFromAF = "";

    /**************************************************
     * 1) AF_MAP prioritaire
     **************************************************/
    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);
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
      if (!engin && M.engin) engin = M.engin;
      if (!fao) fao = buildFAO(zone, sousZone);
    } else {
      // 🔁 On prépare l'objet pour la popup AF_MAP (comme SOGELMER)
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation || "",
        designationInterne: L.designation || "",
        aliasFournisseur: L.designation || "",
        nomLatin: L.nomLatin || "",
        zone: L.zone || "",
        sousZone: L.sousZone || "",
        engin: L.engin || "",
        allergenes: "",
        achatId,
        lineId: null // sera rempli après addDoc
      });
    }

    /**************************************************
     * 2) Fallback fiche ARTICLE si AF_MAP n'a pas donné de désignation
     **************************************************/
    const art = plu ? artMap[plu] : null;
    if (art) {
      if (!cleanFromAF) {
        const artDesignation =
          (art.Designation || art.designation || "").trim();
        if (artDesignation) {
          L.designation = artDesignation;
          designationInterne = artDesignation;
        }
      }
      if (!L.nomLatin || /total/i.test(L.nomLatin)) {
        L.nomLatin = (art.NomLatin || art.nomLatin || L.nomLatin || "").trim();
      }
      if (!zone && (art.Zone || art.zone)) zone = art.Zone || art.zone;
      if (!sousZone && (art.SousZone || art.sousZone))
        sousZone = art.SousZone || art.sousZone;
      if (!engin && (art.Engin || art.engin)) engin = art.Engin || art.engin;
      if (!fao) fao = buildFAO(zone, sousZone);
    }

    /**************************************************
     * 🪝 Normalisation automatique des engins de pêche
     **************************************************/
    if (engin) {
      const e = engin.toUpperCase().trim();
      if (e.includes("FILMAIL")) engin = "FILET MAILLANT";
      else if (e.includes("FILTS")) engin = "FILET TOURNANT";
      else if (e.includes("LIGNE")) engin = "LIGNE";
      else if (e.includes("CHALUT")) engin = "CHALUT";
      // autres règles possibles...
    }

    /**************************************************
     * 3) Enregistrement de la ligne d'achat
     **************************************************/
    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
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
      updatedAt: serverTimestamp()
    });

    // 🔗 On associe l'ID de la ligne aux entrées missingRefs correspondantes
    for (const ref of missingRefs) {
      if (
        ref.refFournisseur === L.refFournisseur &&
        ref.achatId === achatId &&
        !ref.lineId
      ) {
        ref.lineId = lineRef.id;
      }
    }
  }

  /**************************************************
   * 4) Mise à jour du header d'achat
   **************************************************/
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: Number(totalHT.toFixed(2)),
    montantTTC: Number(totalHT.toFixed(2)),
    totalKg: Number(totalKg.toFixed(3)),
    updatedAt: serverTimestamp()
  });

  /**************************************************
   * 5) Si PLU manquants → popup AF_MAP puis MAJ lignes
   **************************************************/
  if (missingRefs.length > 0) {
    console.warn("⚠️ Références non trouvées dans AF_MAP:", missingRefs);

    // 🧩 On importe le module de gestion AF_MAP (popup)
    const { manageAFMap } = await import("./manage-af-map.js");
    await manageAFMap(missingRefs); // l'utilisateur choisit les PLU

    // 🔁 On relit AF_MAP après la popup
    const afSnap2 = await getDocs(collection(db, "af_map"));
    const afMap2 = {};
    afSnap2.forEach(d => {
      afMap2[d.id.toUpperCase()] = d.data();
    });

    // 🛠 On met à jour chaque ligne d'achat avec le PLU fraîchement mappé
    for (const ref of missingRefs) {
      if (!ref.lineId) continue; // sécurité

      const mapped = findAFMapEntry(
        afMap2,
        ref.fournisseurCode,
        ref.refFournisseur
      );
      if (!mapped) continue;

      const newPlu = (mapped.plu || "").toString().trim().replace(/\.0$/, "");
      const newDesignation =
        (mapped.designationInterne || ref.designationInterne || "").trim();

      await updateDoc(
        doc(db, "achats", ref.achatId, "lignes", ref.lineId),
        {
          plu: newPlu,
          designationInterne: newDesignation,
          designation: newDesignation || ref.designation,
          updatedAt: serverTimestamp()
        }
      );
      console.log("🔄 Ligne mise à jour après AF_MAP:", ref.lineId, newPlu);
    }

    alert("✅ BL importé et PLU associés (Royale Marée). Recharge la page.");
    return;
  }

  /**************************************************
   * 6) Aucun PLU manquant → import normal
   **************************************************/
  alert(`✅ ${lines.length} lignes importées pour Royale Marée`);
  location.reload();
}

/**************************************************
 * 🧾 Entrée principale
 **************************************************/
export async function importRoyaleMaree(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseRoyaleMareeLines(text);
  await saveRoyaleMaree(lines);
}
