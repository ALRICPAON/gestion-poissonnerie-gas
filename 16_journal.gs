/***************************************************
 * 16_journal.gs — CA / COGS / marge brute jour   *
 ***************************************************/

/**
 * Met à jour le journal de gestion pour un jour donné depuis les données d’inventaire.
 * Utilise les colonnes : CA théorique HT, CA réel HT, Achats HT
 */
function mettreAJourJournalDepuisInventaire_(dateStr) {
  const shJ = getSheetOrThrow_(SHEET_NAMES.JOURNAL);
  const shI = getSheetOrThrow_(SHEET_NAMES.INVENTAIRE);

  const date = new Date(dateStr);
  const dateFormat = formatDate_(date);

  const invData = shI.getDataRange().getValues();
  const invHeaders = invData[0];
  const idxPLU = invHeaders.indexOf('PLU');
  const idxPVHT = invHeaders.indexOf('Prix vente HT/kg');
  const idxPoidsVendu = invHeaders.indexOf('Poids vendu');
  const idxCAreelHT = invHeaders.indexOf('CA réel HT');

  let CA_theo = 0;
  let CA_reel = 0;
  for (let i = 1; i < invData.length; i++) {
    const row = invData[i];
    const poids = parseFloat(row[idxPoidsVendu]) || 0;
    const pvht = parseFloat(row[idxPVHT]) || 0;
    const careel = parseFloat(row[idxCAreelHT]) || 0;
    CA_theo += poids * pvht;
    CA_reel += careel;
  }

  // Lire feuille Stock pour valeur achat
  const shS = getSheetOrThrow_(SHEET_NAMES.STOCK);
  const stockData = shS.getDataRange().getValues();
  const stockHeaders = stockData[0];
  const idxTotalHT = stockHeaders.indexOf('Valeur totale HT');
  const totalAchatsHT = stockData.slice(1).reduce((sum, r) => sum + (parseFloat(r[idxTotalHT]) || 0), 0);

  // Marge brute
  const margeHT = CA_reel - totalAchatsHT;
  const margePct = CA_reel ? (margeHT / CA_reel) : 0;

  // Cherche si la date existe
  const journalData = shJ.getDataRange().getValues();
  const idxDate = journalData[0].indexOf('Date');
  let rowIdx = journalData.findIndex((r, i) => i > 0 && formatDate_(r[idxDate]) === dateFormat);
  if (rowIdx === -1) rowIdx = journalData.length;

  const ligne = [date, CA_theo, CA_reel, totalAchatsHT, margeHT, margePct];
  const headers = ['Date', 'CA théorique HT', 'CA réel HT', 'Achats HT', 'Marge HT', 'Marge %'];
  if (journalData.length === 0) shJ.getRange(1, 1, 1, headers.length).setValues([headers]);
  shJ.getRange(rowIdx + 1, 1, 1, ligne.length).setValues([ligne]);

  log_(`📊 Journal mis à jour pour ${dateFormat}`);
}
