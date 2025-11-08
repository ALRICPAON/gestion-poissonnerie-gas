/******************************************
 * 10_achats.gs — gestion des achats     *
 ******************************************/

/**
 * Fonction principale d'import de BL depuis la feuille "Achats"
 * Détecte si c'est un BL criée ou fournisseur, applique les règles, et insère les lignes.
 */
function importBLFromSheet_() {
  const sh = getSheetOrThrow_(SHEET_NAMES.ACHATS);
  const data = sh.getDataRange().getValues();

  const isCriee = detectCrieeBL_(data);
  const startRow = 2; // en-têtes sur ligne 1
  let count = 0;

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    const plu = row[0];
    const poids = parseFloat(row[5]);
    const prixHT = parseFloat(row[6]);

    if (!plu || !poids || isNaN(prixHT)) continue;

    // Calcul majoration si criée
    let prixCorrigé = prixHT;
    if (isCriee) {
      prixCorrigé = prixHT * 1.10 + 0.30;
    }

    // Insère la ligne proprement dans le stock (ex: appel à ajouterMouvementStockEntrant_())
    ajouterMouvementStockEntrant_({
      plu,
      poids,
      prixHT: prixCorrigé,
      source: isCriee ? 'CRIÉE' : 'FOURNISSEUR',
      ligneSource: i + 1
    });

    count++;
  }

  SpreadsheetApp.getUi().alert(`${count} ligne(s) importée(s) avec succès depuis le BL ${isCriee ? 'criée' : 'fournisseur'}.`);
}

/**
 * Détecte automatiquement si le BL semble venir d'une criée (pas d'en-têtes, colonnes typiques)
 */
function detectCrieeBL_(data) {
  const headerRow = data[0];
  return !headerRow.includes('Désignation') && data[1] && typeof data[1][0] === 'string' && typeof data[1][6] === 'number';
}

/**
 * Ajoute un mouvement de stock à partir d'un achat entrant (à implémenter dans le fichier Stock)
 */
function ajouterMouvementStockEntrant_({ plu, poids, prixHT, source, ligneSource }) {
  // Cette fonction doit créer ou mettre à jour le lot dans la base de stock (à faire dans le module Stock)
  log_(`➕ Entrée stock pour PLU ${plu} depuis ligne ${ligneSource} : ${poids} kg à ${prixHT.toFixed(2)} €/kg (${source})`);
  // À compléter dans le fichier 11_stock.gs
}
