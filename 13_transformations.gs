/*************************************************
 * 13_transformations.gs — gestion des recettes  *
 *************************************************/

/**
 * Transforme un article source en produit fini en mettant à jour le stock.
 * Exemple : 10kg de PLU 3063 -> 8kg de PLU 3065
 */
function effectuerTransformation_(sourcePLU, poidsSource, ciblePLU, poidsCible) {
  const sh = getSheetOrThrow_(SHEET_NAMES.STOCK);
  const data = sh.getDataRange().getValues();
  const header = data[0];

  const idxPLU = header.indexOf('PLU');
  const idxPoids = header.indexOf('Poids (kg)');
  const idxPA = header.indexOf('Prix achat HT/kg');
  const idxTotal = header.indexOf('Valeur totale HT');

  if ([idxPLU, idxPoids, idxPA, idxTotal].includes(-1)) throw new Error("Colonnes manquantes dans Stock");

  let prixSource = null;
  let ligneSource = null;
  let ligneCible = null;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const plu = String(row[idxPLU]);
    if (plu === sourcePLU) ligneSource = i;
    if (plu === ciblePLU) ligneCible = i;
  }

  if (ligneSource === null) throw new Error("PLU source non trouvé dans le stock : " + sourcePLU);

  const poidsDispo = parseFloat(data[ligneSource][idxPoids]) || 0;
  const paSource = parseFloat(data[ligneSource][idxPA]) || 0;

  if (poidsDispo < poidsSource) throw new Error("Stock insuffisant sur le PLU source.");

  // Calcul du PA transformé en fonction du rendement
  const totalSource = paSource * poidsSource;
  const paCible = poidsCible ? totalSource / poidsCible : paSource;

  // MAJ ligne source
  const nouveauPoidsSource = poidsDispo - poidsSource;
  const nouveauTotalSource = nouveauPoidsSource * paSource;
  sh.getRange(ligneSource + 1, idxPoids + 1).setValue(nouveauPoidsSource);
  sh.getRange(ligneSource + 1, idxTotal + 1).setValue(nouveauTotalSource);

  // MAJ ligne cible
  if (ligneCible !== null) {
    const ancienPoids = parseFloat(data[ligneCible][idxPoids]) || 0;
    const ancienTotal = parseFloat(data[ligneCible][idxTotal]) || 0;
    const poidsTotal = ancienPoids + poidsCible;
    const totalCumule = ancienTotal + totalSource;
    const nouveauPA = poidsTotal ? totalCumule / poidsTotal : paCible;

    sh.getRange(ligneCible + 1, idxPoids + 1).setValue(poidsTotal);
    sh.getRange(ligneCible + 1, idxPA + 1).setValue(nouveauPA);
    sh.getRange(ligneCible + 1, idxTotal + 1).setValue(totalCumule);
  } else {
    const ligne = [];
    ligne[idxPLU] = ciblePLU;
    ligne[idxPoids] = poidsCible;
    ligne[idxPA] = paCible;
    ligne[idxTotal] = poidsCible * paCible;
    sh.appendRow(ligne);
  }

  log_(`🔄 Transformation : -${poidsSource}kg ${sourcePLU} ➜ +${poidsCible}kg ${ciblePLU}`);
}
