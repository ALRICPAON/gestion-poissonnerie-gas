/**************************************************
 * TRAITEMENT TRANSFORMATION SIMPLE (VERSION STABLE)
 **************************************************/
async function handleSimpleTransformation(e) {
  e.preventDefault();

  const pluSource = document.getElementById("plu-source").value.trim();
  const poidsSource = Number(document.getElementById("poids-source").value);
  const pluFinal   = document.getElementById("plu-final").value.trim();
  const poidsFinal = Number(document.getElementById("poids-final").value);

  if (!pluSource || !poidsSource || !pluFinal || !poidsFinal) {
    alert("Champs manquants");
    return;
  }

  /**************************************************
   * 1️⃣ Récupération lot source
   **************************************************/
  const snapLots = await getDocs(collection(db, "lots"));
  let sourceLot = null;

  snapLots.forEach(d => {
    const l = d.data();
    if (l.plu == pluSource && (l.poidsRestant || 0) > 0) {
      sourceLot = { id: d.id, ...l };
    }
  });

  if (!sourceLot) {
    alert("Aucun lot disponible pour ce PLU.");
    return;
  }
  if (poidsSource > sourceLot.poidsRestant) {
    alert("Poids consommé supérieur au restant !");
    return;
  }

  const prixSourceKg = sourceLot.prixAchatKg;
  const coutTotal = prixSourceKg * poidsSource;
  const prixFinalKg = coutTotal / poidsFinal;

  /**************************************************
   * 2️⃣ MOUVEMENT STOCK (sortie)
   **************************************************/
  await addDoc(collection(db, "stock_movements"), {
    plu: pluSource,
    lotId: sourceLot.id,
    poids: poidsSource,
    sens: "sortie",
    type: "transformation",
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "lots", sourceLot.id), {
    poidsRestant: sourceLot.poidsRestant - poidsSource
  });

  /**************************************************
   * 3️⃣ Traçabilité propagée DU LOT SOURCE
   **************************************************/
  const traca = {
    nomLatin   : sourceLot.nomLatin   || "",
    zone       : sourceLot.zone       || "",
    sousZone   : sourceLot.sousZone   || "",
    engin      : sourceLot.engin      || "",
    allergenes : sourceLot.allergenes || "",
    fao        : sourceLot.fao        || "",
    dlc        : sourceLot.dlc || sourceLot.dltc || ""
  };

  /**************************************************
   * 4️⃣ Récupération désignation du PLU final
   **************************************************/
  const finalArticleDoc = await getDoc(doc(db, "articles", pluFinal));
  const desFinal = finalArticleDoc.exists()
    ? (finalArticleDoc.data().Designation || finalArticleDoc.data().designation)
    : "Transformation";

  /**************************************************
   * 5️⃣ CREATION DU LOT FINAL
   **************************************************/
  const newLotRef = await addDoc(collection(db, "lots"), {
    plu: pluFinal,
    designation: desFinal,
    poidsRestant: poidsFinal,
    prixAchatKg: prixFinalKg,
    type: "transformation",

    // 🔥 Traçabilité copiée
    ...traca,

    origineLot: sourceLot.id,
    createdAt: serverTimestamp()
  });

  /**************************************************
   * 6️⃣ HISTORIQUE TRANSFORMATION
   **************************************************/
  await addDoc(collection(db, "transformations"), {
    type: "simple",
    pluSource,
    poidsSource,
    pluFinal,
    poidsFinal,
    prixFinalKg,
    lotFinalId: newLotRef.id,
    designationSource: sourceLot.designation || "",
    designationFinal : desFinal,
    createdAt: serverTimestamp()
  });

  alert("Transformation enregistrée !");
  loadHistorique();
}
