/************************************
 * 01_helpers.gs — fonctions utiles *
 ************************************/

/**
 * Renvoie une feuille par nom ou erreur claire.
 */
function getSheetOrThrow_(sheetName) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) throw new Error(`Feuille introuvable : ${sheetName}`);
  return sh;
}

/**
 * Normalise une clé FAO pour comparaison (sans accent, majuscule, espaces).
 */
function _normKeyFAO_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convertit un chiffre romain I..XII en entier pour le tri.
 */
function _romanToInt_(r) {
  const map = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  let s = String(r || '').toUpperCase().replace(/[^IVXLCDM]/g, '');
  if (!s) return 0;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const current = map[s[i]];
    const next = map[s[i + 1]] || 0;
    total += current < next ? next - current : current;
    if (current < next) i++;
  }
  return total;
}

/**
 * Formate une date au format dd/MM/yyyy.
 */
function formatDate_(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), DATE_FORMAT);
}

/**
 * Ajoute un log clair dans la console.
 */
function log_(msg, data) {
  console.log(`[GP] ${msg}`);
  if (data !== undefined) console.log(data);
}
