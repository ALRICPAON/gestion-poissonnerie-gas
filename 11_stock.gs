/*******************************************
 * 11_stock.gs — gestion du stock & FIFO   *
 *******************************************/

/**
 * Ajoute un lot ou complète un lot existant dans la feuille Stock à partir d’un mouvement entrant.
 */
function ajouterMouvementStockEntrant_({ plu, poids, prixHT, source, ligneSource }) {
  const sh = getSheetOrThrow_(SHEET_NAMES.STOCK);
  const data = sh.getDataRange().getValues();
  const header = data[0];

  const idxPLU = header.indexOf('PLU');
  const idxPoids = header.indexOf('Poids (kg)');
  const idxPA = header.indexOf('Prix achat HT/kg');
  const idxTotal = header.indexOf('Valeur totale HT');

  // Cherche si le PLU existe déjà
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxPLU]) === String(plu)) {
      // MAJ cumulée : poids, valeur, prix moyen
      const ancienPoids = parseFloat(data[i][idxPoids]) || 0;
      const ancienTotal = parseFloat(data[i][idxTotal]) || 0;
      const nouveauTotal = prixHT * poids;
      const poidsTotal = ancienPoids + poids;
      const totalCumule = ancienTotal + nouveauTotal;
      const nouveauPA = poidsTotal ? totalCumule / poidsTotal : prixHT;

      sh.getRange(i + 1, idxPoids + 1).setValue(poidsTotal);
      sh.getRange(i + 1, idxPA + 1).setValue(nouveauPA);
      sh.getRange(i + 1, idxTotal + 1).setValue(totalCumule);

      log_(`MAJ stock existant PLU ${plu} : +${poids}kg à ${prixHT.toFixed(2)}€/kg`);
      found = true;
      break;
    }
  }

  if (!found) {
    // Nouvelle ligne
    const lastRow = sh.getLastRow() + 1;
    const ligne = [];
    ligne[idxPLU] = plu;
    ligne[idxPoids] = poids;
    ligne[idxPA] = prixHT;
    ligne[idxTotal] = poids * prixHT;

    sh.getRange(lastRow, 1, 1, ligne.length).setValues([ligne]);
    log_(`Ajout nouveau stock PLU ${plu} : ${poids}kg à ${prixHT.toFixed(2)}€/kg`);
  }
}
