/******************************************
 * 00_constants.gs — constantes globales  *
 ******************************************/

/** Feuilles principales */
const SHEET_NAMES = {
  FOURNISSEURS: 'Fournisseurs',
  ARTICLES: 'Articles',
  ACHATS: 'Achats',
  STOCK: 'Stock',
  INVENTAIRE: 'Inventaire',
  JOURNAL: 'Journal',
  PARAMETRES: 'Paramètres',
  ETIQUETTES: '_Etiquettes',
  DASHBOARD: 'Tableau de bord',
  TRANSFO: 'Transformations',
  TRACE: 'Trace_DB',
  FOURN_MAP: 'AF_MAP',
  ACHAT_FOURN: 'Achats Fournisseur'
};

/** Clés d'entête types */
const HEADERS = {
  PLU: 'PLU',
  DESIGNATION: 'Désignation',
  FOURNISSEUR: 'Fournisseur',
  PRIX_HT_KG: 'Prix HT/kg',
  POIDS_KG: 'Poids (kg)',
  DATE: 'Date',
  LOT: 'Lot',
  ZONE: 'Zone',
  SOUS_ZONE: 'Sous-zone',
  ENGIN: 'Engin',
  NOM_LATIN: 'Nom latin',
  DECONGELE: 'Décongelé',
  ALLERGENES: 'Allergènes'
};

/** ID du dossier Drive racine (à remplacer) */
const DRIVE_ROOT_FOLDER_ID = 'INSERER_ID_DOSSIER_DRIVE';

/** Format de date */
const DATE_FORMAT = 'dd/MM/yyyy';

/** Nom du menu personnalisé */
const CUSTOM_MENU_NAME = '🐟 GP';
