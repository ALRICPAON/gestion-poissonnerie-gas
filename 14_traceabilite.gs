/**************************************************
 * 14_traceabilite.gs — suivi FIFO + normalisation *
 **************************************************/

/**
 * Fonction utilitaire : nettoie les noms FAO/sous-zone/engin pour affichage/étiquette.
 */
function normaliserZoneEtEngin_(zone, sousZone, engin) {
  const out = {
    zone: '',
    sousZone: '',
    engin: ''
  };

  const norm = s => String(s || '').toUpperCase().replace(/[\s\-/]/g, '').replace(/FAO/, '').trim();

  // Zones FAO
  if (zone) out.zone = 'FAO ' + norm(zone).replace(/[^0-9]/g, '');
  if (sousZone) out.sousZone = ' ' + norm(sousZone).replace(/[^A-Z0-9]/g, '').replace(/([IVX]+)([A-Z]*)/, ' $1 $2');

  // Engins de pêche
  const enginsCanon = ["CHALUT OTB", "LIGNE LHP", "CASIER FPO", "SENNE", "PALANGRE", "FILET GNS"];
  const cleanEngin = norm(engin);
  const match = enginsCanon.find(e => cleanEngin.includes(e.replace(/\s/g, '')));
  out.engin = match || engin || '';

  return out;
}

/**
 * Nettoie les doublons et incohérences dans les zones FAO / Engins d’un tableau donné.
 */
function harmoniserMetaTraçabilité_(data, idxZone, idxSousZone, idxEngin) {
  for (let i = 1; i < data.length; i++) {
    const zone = data[i][idxZone];
    const sousZone = data[i][idxSousZone];
    const engin = data[i][idxEngin];
    const res = normaliserZoneEtEngin_(zone, sousZone, engin);
    data[i][idxZone] = res.zone;
    data[i][idxSousZone] = res.sousZone.trim();
    data[i][idxEngin] = res.engin;
  }
  return data;
}

/**
 * Gère la fiche de traçabilité FIFO : entrées/consommations par lot (à implémenter à part si besoin)
 */
function genererFicheTracabiliteFIFO_(plu, dateDebut, dateFin) {
  // Placeholder pour future implémentation complète basée sur feuille Trace_DB ou Firestore
  log_(`📋 Traçabilité FIFO à générer pour ${plu} du ${dateDebut || 'début'} au ${dateFin || 'fin'}`);
}
