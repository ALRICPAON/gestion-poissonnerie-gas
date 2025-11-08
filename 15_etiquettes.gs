/***************************************************
 * 15_etiquettes.gs — préparation & export Excel   *
 ***************************************************/

/**
 * Prépare les étiquettes conformes dans la feuille "_Etiquettes".
 */
function prepareEtiquettesEvolisExact_() {
  const ss = SpreadsheetApp.getActive();
  const shStock = getSheetOrThrow_(SHEET_NAMES.STOCK);
  const shEtiq = ss.getSheetByName(SHEET_NAMES.ETIQUETTES) || ss.insertSheet(SHEET_NAMES.ETIQUETTES);

  const data = shStock.getDataRange().getValues();
  const headers = data[0];

  const idxPLU = headers.indexOf('PLU');
  const idxDesign = headers.indexOf('Désignation');
  const idxNomLat = headers.indexOf('Nom latin');
  const idxZone = headers.indexOf('Zone');
  const idxSousZone = headers.indexOf('Sous-zone');
  const idxEngin = headers.indexOf('Engin');
  const idxDecong = headers.indexOf('Décongelé');
  const idxAllerg = headers.indexOf('Allergènes');
  const idxPrix = headers.indexOf('Prix vente TTC/kg');

  // En-tête
  const enTete = ["type", "criee", "", "PLU", "designation", "Nom scientif", "Méthode Prod", "Zone Pêche", "Engin Pêche", "Décongelé", "Allergènes", "Prix", "€/kg ou Pièce"];
  shEtiq.clear();
  shEtiq.getRange(1, 1, 1, enTete.length).setValues([enTete]);

  const lignes = [];

  for (let i = 1; i < data.length; i++) {
    const plu = data[i][idxPLU];
    const d = data[i];

    if (!plu) continue;

    const meta = normaliserZoneEtEngin_(d[idxZone], d[idxSousZone], d[idxEngin]);

    const ligne = [
      'prixkg', // type
      '', '', // colonne vide/criée
      plu,
      d[idxDesign] || '',
      d[idxNomLat] || '',
      'PÊCHÉ',
      meta.zone + meta.sousZone,
      meta.engin,
      d[idxDecong] || 'NON',
      d[idxAllerg] || '',
      d[idxPrix] || '',
      '€/kg'
    ];

    lignes.push(ligne);
  }

  if (lignes.length > 0) shEtiq.getRange(2, 1, lignes.length, lignes[0].length).setValues(lignes);

  log_(`📦 ${lignes.length} étiquettes prêtes dans la feuille _Etiquettes.`);
}

/**
 * Exporte la feuille _Etiquettes au format .xlsx dans Drive
 */
function exportEtiquettesXLSX_() {
  const sh = getSheetOrThrow_(SHEET_NAMES.ETIQUETTES);
  const folder = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const blob = sh.getParent().getBlob().getAs('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const file = folder.createFile(blob).setName(`Etiquettes_${new Date().toISOString().slice(0, 10)}.xlsx`);

  SpreadsheetApp.getUi().alert("✅ Fichier exporté dans Drive : " + file.getName());
  log_(`📤 Export .xlsx : ${file.getName()}`);
}
