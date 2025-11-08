/**********************************************
 * 99_main.gs — point d’entrée / global        *
 **********************************************/

/**
 * Fonction d’entrée principale à appeler manuellement si besoin.
 */
function main() {
  log_('🔁 Script GP initialisé. Vous pouvez utiliser le menu 🐟.');
  // Exemple d’appel :
  // pushInventaireStockReelToStockAndValidate();
  // mettreAJourJournalDepuisInventaire_('2025-11-08');
}

/**
 * Exporte tout le stock en log lisible (à titre de vérif/debug).
 */
function debugAfficherStockConsole_() {
  const sh = getSheetOrThrow_(SHEET_NAMES.STOCK);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  log_(`📦 Stock actuel (${data.length - 1} lignes)`);
  for (let i = 1; i < data.length; i++) {
    const ligne = headers.map((h, idx) => `${h}: ${data[i][idx]}`).join(' | ');
    console.log(`→ ${ligne}`);
  }
}
