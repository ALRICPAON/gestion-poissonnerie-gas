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
  getDocs,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**************************************************
 * 🔎 Recherche AF_MAP — tolère zéros supprimés
 **************************************************/
function findAFMapEntry(afMap, fourCode, refFournisseur) {
  if (!refFournisseur) return null;
  const refStr = refFournisseur.toString().trim();
  const keyExact = `${fourCode}__${refStr}`.toUpperCase();
  const keyNoZero = `${fourCode}__${refStr.replace(/^0+/, "")}`.toUpperCase();
  const keyPad = `${fourCode}__${refStr.padStart(5, "0")}`.toUpperCase();
  return afMap[keyExact] || afMap[keyNoZero] || afMap[keyPad] || null;
}

/**************************************************
 * 🧩 FAO normalisé (y compris élevage)
 **************************************************/
function buildFAO(zone, sousZone) {
  if (!zone) return "";
  const isElev = zone.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().startsWith("ELEV");
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
  if (!pdfjsLib) throw new Error("PDF.js non chargé");

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    fullText += content.items.map(i => i.str).join("\n") + "\n";
  }
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
    .filter(l => l.length);

  let current = null;
  let stage = 0;

  const isCode = s => /^\d{4,5}$/.test(s);
  const isInt = s => /^\d+$/.test(s);
  const isNum = s => /^[\d]+(?:,\d+)?$/.test(s);
  const isLatin = s => /^[A-Z][a-z]+(?:\s+[A-Za-z]+){1,2}(?:\s+[A-Z]{2,5})?$/.test(s);

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
      if (/total|bon|etablissement/i.test(raw)) continue;

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
        const all = [...raw.matchAll(/FAO\s*([0-9]{1,3})[ .]*([IVX]*)/gi)];
        if (all.length) {
          const last = all[all.length - 1];
          current.zone = `FAO${last[1]}`;
          current.sousZone = last[2] ? last[2].toUpperCase().replace(/\./g, "") : "";
          current.fao = buildFAO(current.zone, current.sousZone);
        }
        if (/Elevé/i.test(raw)) {
          current.zone = "ÉLEVAGE";
          const m = raw.match(/Elevé.+?en\s*:?\s*([^|]+)/i);
          if (m) current.sousZone = m[1].trim().toUpperCase();
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

  if (current) rows.push(current);

  return rows.filter(r =>
    r.refFournisseur && r.designation && r.designation.length > 2
  );
}

/**************************************************
 * 💾 Sauvegarde Firestore + popup AF_MAP
 **************************************************/
async function saveRoyaleMaree(lines) {
  if (!lines.length) throw new Error("Aucune ligne trouvée");
  const FOUR_CODE = "10004";

  const [afSnap, artSnap] = await Promise.all([
    getDocs(collection(db, "af_map")),
    getDocs(collection(db, "articles"))
  ]);

  const afMap = {};
  afSnap.forEach(d => (afMap[d.id.toUpperCase()] = d.data()));

  const artMap = {};
  artSnap.forEach(d => {
    const a = d.data();
    if (a?.plu) artMap[a.plu.toString().trim()] = a;
  });

  const achatRef = await addDoc(collection(db, "achats"), {
    date: new Date().toISOString().slice(0, 10),
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

    const M = findAFMapEntry(afMap, FOUR_CODE, L.refFournisseur);

    if (M) {
      plu = (M.plu || "").toString();
      if (M.designationInterne) designationInterne = M.designationInterne;
    } else {
      missingRefs.push({
        fournisseurCode: FOUR_CODE,
        refFournisseur: L.refFournisseur,
        designation: L.designation,
        designationInterne: L.designation,
        aliasFournisseur: L.designation,
        nomLatin: L.nomLatin,
        zone: L.zone,
        sousZone: L.sousZone,
        engin: L.engin,
        allergenes: "",
        achatId,
        lineId: null
      });
    }

    const lineRef = await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: L.refFournisseur,
      designation: designationInterne,
      nomLatin: L.nomLatin,
      colis: L.colis,
      poidsColisKg: L.poidsColisKg,
      poidsTotalKg: L.poidsTotalKg,
      prixKg: L.prixKg,
      montantHT: L.montantHT,
      zone: L.zone,
      sousZone: L.sousZone,
      engin: L.engin,
      lot: L.lot,
      fao: L.fao,
      plu,
      designationInterne,
      allergenes: "",
      fournisseurRef: L.refFournisseur,
      montantTTC: L.montantHT,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    /**************************************************
 * PATCH AUTO — mise à jour après popup AF_MAP
 **************************************************/
if (!M) {
  const refKey = (`${FOUR_CODE}__${L.refFournisseur}`).toUpperCase();

  setTimeout(async () => {
    const snap = await getDoc(doc(db, "af_map", refKey));
    if (!snap.exists()) return;

    const mapped = snap.data();

    await updateDoc(
      doc(db, "achats", achatId, "lignes", lineRef.id),
      {
        plu: mapped.plu || "",
        designationInterne: mapped.designationInterne || "",
        designation: mapped.designationInterne || "",
        updatedAt: serverTimestamp()
      }
    );

    console.log("🔄 Royale Marée — Ligne mise à jour après AF_MAP :", lineRef.id);
  }, 500);
}


    // 🔗 Associe lineId pour la popup
    for (const ref of missingRefs) {
      if (ref.refFournisseur === L.refFournisseur && ref.lineId === null) {
        ref.lineId = lineRef.id;
      }
    }
  }

  await updateDoc(doc(db, "achats", achatId), {
    montantHT: Number(totalHT.toFixed(2)),
    montantTTC: Number(totalHT.toFixed(2)),
    totalKg: Number(totalKg.toFixed(3)),
    updatedAt: serverTimestamp()
  });

  /**************************************************
   * 📌 POPUP AF_MAP si besoin
   **************************************************/
  if (missingRefs.length > 0) {
    console.log("⚠ Missing refs:", missingRefs);
    const { manageAFMap } = await import("./manage-af-map.js");
    await manageAFMap(missingRefs);
    alert("🔄 PLU associés. Recharge la page.");
    return;
  }

  alert(`✅ ${lines.length} lignes importées (Royale Marée)`);
  location.reload();
}

/**************************************************
 * Entrée principale
 **************************************************/
export async function importRoyaleMaree(file) {
  const text = await extractTextFromPdf(file);
  const lines = parseRoyaleMareeLines(text);
  await saveRoyaleMaree(lines);
}
