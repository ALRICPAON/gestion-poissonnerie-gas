/************************************************
 * 12_inventaire.gs — validation + push stock  *
 ************************************************/

/**
 * Met à jour le stock réel depuis l'inventaire (colonne I), et pousse vers Stock théorique (colonne B)
 */
function pushInventaireStockReelToStockAndValidate() {
  const ss  = SpreadsheetApp.getActive();
  const shI = getSheetOrThrow_(SHEET_NAMES.INVENTAIRE);
  const shS = getSheetOrThrow_(SHEET_NAMES.STOCK);

  const dataInv = shI.getDataRange().getValues();
  const headerI = dataInv[0];

  const idxPLU = headerI.indexOf("PLU");
  const idxReel = headerI.indexOf("Stock réel (calculé)");

  if (idxPLU < 0 || idxReel < 0) throw new Error("Colonnes 'PLU' ou 'Stock réel (calculé)' non trouvées");

  const mapReel = new Map();
  for (let i = 1; i < dataInv.length; i++) {
    const row = dataInv[i];
    const plu = row[idxPLU];
    const stockReel = parseFloat(row[idxReel]);
    if (plu && !isNaN(stockReel)) {
      mapReel.set(String(plu), stockReel);
    }
  }

  const dataStock = shS.getDataRange().getValues();
  const headerS = dataStock[0];
  const idxStockTheo = headerS.indexOf("Poids (kg)");
  const idxPLU_S = headerS.indexOf("PLU");

  if (idxStockTheo < 0 || idxPLU_S < 0) throw new Error("Colonnes manquantes dans Stock");

  for (let i = 1; i < dataStock.length; i++) {
    const plu = String(dataStock[i][idxPLU_S]);
    if (mapReel.has(plu)) {
      const valeur = mapReel.get(plu);
      shS.getRange(i + 1, idxStockTheo + 1).setValue(valeur);
      log_(`Inventaire poussé vers stock pour PLU ${plu} : ${valeur} kg`);
    }
  }

  SpreadsheetApp.getUi().alert("✅ Stock mis à jour depuis l’inventaire.");
}
