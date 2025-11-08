/********************************************
 * 02_menu.gs — menu GP + fonctions appelées *
 ********************************************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu(CUSTOM_MENU_NAME)
    .addItem('Ouvrir traçabilité', 'ouvrirTracabilite')
    .addItem('Importer BL', 'importerBL')
    .addItem('Valider inventaire', 'validerInventaire')
    .addSeparator()
    .addItem('Préparer étiquettes Evolis', 'preparerEtiquettesEvolisExact')
    .addItem('Exporter étiquettes (.xlsx)', 'exporterEtiquettesXLSX')
    .addToUi();
}

/** Ouvre ou crée la feuille "Traçabilité" avec les champs de recherche */
function ouvrirTracabilite() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Traçabilité');
  if (!sh) sh = ss.insertSheet('Traçabilité');

  sh.activate();
  sh.clear();
  sh.getRange('A1').setValue('Traçabilité — Entrées').setFontWeight('bold').setFontSize(12).setBackground('#e8f0fe');
  sh.getRange('A2').setValue('PLU');
  sh.getRange('A3').setValue('Date début (optionnel)');
  sh.getRange('A4').setValue('Date fin (optionnel)');
  sh.getRange('A6').setValue('Résultats :').setFontWeight('bold');
}

/** Fonction d’import de BL */
function importerBL() {
  SpreadsheetApp.getUi().alert("L'import de BL doit être appelé depuis la feuille 'Achats'.");
  const sh = getSheetOrThrow_(SHEET_NAMES.ACHATS);
  sh.activate();
  // Appelle la fonction d'import (placeholder)
  if (typeof importBLFromSheet_ === 'function') {
    importBLFromSheet_();
  } else {
    SpreadsheetApp.getUi().alert("Fonction 'importBLFromSheet_' manquante dans le script.");
  }
}

/** Valide l’inventaire actuel et met à jour le stock réel */
function validerInventaire() {
  if (typeof pushInventaireStockReelToStockAndValidate === 'function') {
    pushInventaireStockReelToStockAndValidate();
  } else {
    SpreadsheetApp.getUi().alert("Fonction 'pushInventaireStockReelToStockAndValidate' manquante.");
  }
}

/** Prépare les étiquettes Evolis */
function preparerEtiquettesEvolisExact() {
  if (typeof prepareEtiquettesEvolisExact_ === 'function') {
    prepareEtiquettesEvolisExact_();
  } else {
    SpreadsheetApp.getUi().alert("Fonction 'prepareEtiquettesEvolisExact_' manquante.");
  }
}

/** Exporte les étiquettes au format XLSX */
function exporterEtiquettesXLSX() {
  if (typeof exportEtiquettesXLSX_ === 'function') {
    exportEtiquettesXLSX_();
  } else {
    SpreadsheetApp.getUi().alert("Fonction 'exportEtiquettesXLSX_' manquante.");
  }
}
