import { db } from "../js/firebase-init.js";
import {
  collection, addDoc, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const FOUR_CODE = "10001";   // SCAPMARÉE

export async function importScapmaree(file, achatId, afMap) {

  const wb = XLSX.read(await file.arrayBuffer(), { type:"array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  let totalHT = 0;
  let totalKg = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    let ref = (r[0] ?? "").toString().trim();
    ref = ref.replace(/^0+/, "").replace(/\s+/g, "").replace(/\//g, "_");

    const designation = r[1] ?? "";
    const nomLatin = r[2] ?? "";

    const poidsKg  = parseFloat(r[7] ?? 0);
    const prixHTKg = parseFloat(r[8] ?? 0);
    const totalLigne = parseFloat(r[9] ?? 0);

    totalHT += totalLigne;
    totalKg += poidsKg;

    // Lookup AF_MAP
    const key = `${FOUR_CODE}__${ref}`.toUpperCase();
    const map = afMap[key];

    let plu = map?.plu || "";
    let designationInterne = map?.designationInterne || designation;

    // Lookup Article si PLU trouvé
    let traca = {};
    if (plu) {
      const snap = await getDoc(doc(db, "articles", plu));
      if (snap.exists()) {
        const A = snap.data();
        traca = {
          nomLatin: A.NomLatin || A.nomLatin || nomLatin,
          zone: A.Zone || A.zone || "",
          sousZone: A.SousZone || A.sousZone || "",
          engin: A.Engin || A.engin || ""
        };
      }
    }

    await addDoc(collection(db, "achats", achatId, "lignes"), {
      refFournisseur: ref,
      plu,
      designation,
      designationInterne,
      nomLatin: nomLatin || traca.nomLatin || "",
      poidsKg,
      prixHTKg,
      totalHT: totalLigne,
      zone: traca.zone || "",
      sousZone: traca.sousZone || "",
      engin: traca.engin || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log("✅ LIGNE", ref, " → PLU:", plu);
  }

  // Update achat header
  await updateDoc(doc(db, "achats", achatId), {
    montantHT: totalHT,
    montantTTC: totalHT * 1.1,
    totalKg,
    updatedAt: serverTimestamp()
  });

  alert("✅ Import SCAPMARÉE terminé");
}
