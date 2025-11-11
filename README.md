# 🐟 Récapitulatif Fonctionnel - Outil de Gestion Poissonnerie (version GitHub)

## 🏢 Structure Générale de l'application

Application web (ou Google Sheets / Apps Script en V1) avec authentification par identifiant / mot de passe.

Une base Firebase distincte par utilisateur / magasin (ex: "Leclerc Challans", "Leclerc Atlantis", etc).

Interface claire (web ou Sheets) permettant d'accéder aux modules suivants :

- Articles
- Fournisseurs
- Achats (manuels + import BL + criée)
- Stock (prix moyen pondéré / PV / marges)
- Inventaire (par poids ou CA)
- Traçabilité (lots, FIFO, zones FAO, engins, etc.)
- Transformations
- Tableau de bord (marge brute, CA, etc.)
- Étiquettes (Evolis ou export XLSX)

---

## 📄 ARTICLES / FOURNISSEURS

- Table Articles : PLU, désignation, nom latin, zone, sous-zone, engin, allergènes, unité (€/kg ou pièce), catégorie.
- Ajout, modification, suppression via interface web.
- Fichier JSON généré depuis Excel puis import Firestore via script.
- Édition directe par `prompt()` + reload automatique.
- Barre de recherche dynamique.
- Bouton retour à l’accueil.
- Authentification obligatoire via Firebase Auth.
- Fichiers : `load-articles.js`, `submit-article.js`, `edit-article.js`

### Fournisseurs

- Fichier Excel importé dans Firestore (script `import-fournisseurs.js`)
- Interface design identique aux articles, avec les champs : code, nom, contact, téléphone, email, adresse, notes.
- Ajout via formulaire, suppression et modification inline par `prompt()`
- Tri, recherche, authentification Firebase.
- Fichiers : `load-fournisseurs.js`, `submit-fournisseur.js`, `edit-fournisseur.js`

---

## 💼 ACHATS

- Saisie manuelle ou import BL (Excel, PDF à venir).
- Import criée : mapping sans en-têtes, règle spéciale (+10% + 0,30 €/kg).
- QR code par ligne possible (pour réception et étiquette).
- Stock mis à jour uniquement à la réception effective (photo étiquette / scan QR).
- Gestion des BL scannés / fichiers PDF / étiquettes sanitaires.

---

## 📊 STOCK (FIFO / CUMP)

- Calcul du prix moyen d'achat par article.
- Calcul automatique du prix de vente TTC conseillé, valeur totale du stock, marge.
- FIFO assuré par la base de mouvements (entrées / sorties).
- Export Excel possible à tout moment.

---

## 💻 TRANSFORMATIONS

- Saisie d’une transformation = consommation d'un ou plusieurs articles sources, création d'un produit fini.
- Recalcul automatique du prix de revient en tenant compte du rendement.
- MAJ du stock : - source(s), + produit fini.
- Traçabilité conservée (lots, zones, engins, etc.).

---

## 📊 INVENTAIRE (poids ou CA)

- Saisie du poids restant OU du CA TTC.
- Calcul du poids vendu et du CA HT.
- MAJ du Stock réel et push dans le stock théorique sur validation.
- Journal auto-généré par jour (CA théorique / réel / COGS / marge).

---

## 📊 TRAÇABILITÉ (lots / FIFO / zones)

- Logique FIFO = les plus vieux lots sont consommés en premier.
- Journal de mouvements (achats, ventes, transformations).
- Nettoyage auto des doublons FAO / engins (ex : FAO27VIII -> FAO27 VIII).
- Canonisation des zones et engins à l'import.

---

## 🌐 WEB APP (objectifs futur)

- Interface connectée à Firebase Auth + Firestore.
- Upload possible d'un BL PDF ou image.
- Scan QR = accès instantané au lot, à la fiche traçabilité, à l’étiquette.
- Gestion multi-magasin / multi-rayon.

---

## 🗖️ EXPORT ÉTIQUETTES

- Préparation d'étiquettes conformes (type Evolis).
- Normalisation automatique (zone, engin, élevé/décongelé, allergènes).
- Export en Excel + impression possible.

---

## 🔐 AUTHENTIFICATION / MULTI-MAGASINS

- Chaque utilisateur (magasin) a ses propres données Firebase.
- Login / mot de passe = accès isolé à ses fiches, stocks, etc.

---

## 🧐 Objectif final

> Outil duplicable, fluide, multi-rayon, avec base traçable FIFO, exportable, propre, rapide à utiliser sur le terrain.

✅ Historique GitHub = base unique de vérité.

---

🗓️ **Document mis à jour automatiquement le 2025-11-08 à partir des échanges avec l’utilisateur Alric.**

---

## 🛠️ Configuration Technique Firebase (version web)

### 🔥 firebase-init.js
```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const cfg = {
  apiKey: '…',
  authDomain: '…',
  projectId: '…',
  storageBucket: '…',
  messagingSenderId: '…',
  appId: '…'
};

export const app = initializeApp(cfg);
export const auth = getAuth(app);
export const db = getFirestore(app);
```

### 🗂️ Structure Firestore (Collection: articles)
Chaque document est identifié par son `PLU` :

```json
{
  "PLU": "3002",
  "Designation": "HARENG SAUR",
  "NomLatin": "",
  "Categorie": "Pêché en",
  "Unite": "€/kg",
  "Allergenes": "CONTIENT:HARENG",
  "Zone": "ATLANTIQUE NORD",
  "SousZone": "",
  "Engin": "CHALUT"
}
```

### 🔐 Authentification Firebase
- Email/mot de passe via `firebase-auth`
- Redirection automatique des pages protégées via :
```js
import { onAuthStateChanged } from 'firebase/auth';
onAuthStateChanged(auth, (user) => {
  if (!user) location.replace('/pages/login.html?next=' + location.pathname);
});
```
- Variable `window.__afterAuth = () => { ... };` pour exécuter des scripts après login
- Bouton global de déconnexion : `await signOut(auth)`

---

📌 Pense-bête : bien importer les modules `firebase/firestore.js` (et non `firestore-lite.js`) pour éviter les erreurs de type "Expected CollectionReference…"

🔽 Mise à jour le 2025-11-08
🐟 GESTION POISSONNERIE — RÉCAP GLOBAL
✅ OBJECTIF

Créer un outil pro, rapide, multi-magasins, permettant :

Gestion achats + réception

Suivi FIFO / traçabilité

Calcul stock / marges

Transformations

Inventaire

Étiquettes sanitaires

🎯 Idéal pour rayon GMS / poissonnerie indépendante

🔐 AUTHENTIFICATION & MULTI-MAGASINS

Connexion email + mot de passe

1 base par magasin

Données totalement isolées

Accès sécurisé aux modules

📦 MODULE — ARTICLES

📘 Base catalogue

✅ Champs :

PLU

Désignation

Nom latin

Zone / Sous-zone

Engin de pêche

Allergènes

Catégorie

Unité (€/kg ou unité)

✅ Fonctions :

Création / modification / suppression

Import depuis Excel

Autofill traçabilité lors des achats

Recherche rapide

Popup sélection (F9)

🚚 MODULE — FOURNISSEURS

✅ Champs :

Code

Nom

Contact

Téléphone

Email

Notes

✅ Fonctions :

CRUD

Recherche

Mapping AF → permet de remplir automatiquement une ligne d’achat selon la ref fournisseur

🧾 MODULE — ACHATS
✅ OBJECTIF

Saisie + réception + mise à jour stock

✅ PROCESS

Création achat

Saisie lignes :

PLU

Désignation

Colis

Poids par colis

Poids total

Prix/kg

Montant HT

Autofill traçabilité depuis fiche article
→ Nom latin / Zone / Sous-zone / Engin / Allergènes

Génération automatique du LOT
→ format AAAA MM JJ HH MM SS – XX

Auto-calcul poids total + montant

QR Code par ligne

Possibilité d’ajouter photo étiquette sanitaire

Conversion → BL :
✅ Chaque ligne est intégrée au stock (FIFO)

✅ Actions rapides

F9 = choisir article catalogue

AF = appliquer mappage fournisseur

📷 = photo sanitaire

◼︎ = QR code

🗑️ = supprimer ligne

✅ Auto-total en fin de page

📦 MODULE — STOCK

Méthode : mouvements stock FIFO

📥 Entrées :

Réception achat

Transformation produit fini

📤 Sorties :

Inventaire

Transformation produit source

💰 Calculs :

FIFO natif

CUMP (prix moyen pondéré)

Valeur stock

Marge brute théorique

🔁 MODULE — TRANSFORMATIONS

Transformer un produit → un autre

✅ Fonctionnement :

Source = 1 ou plusieurs lots FIFO

Rendement (%) appliqué

Calcul nouveau CUMP produit fini

Sorties stock (source) + entrée stock (fini)

Traçabilité conservée

Exemple :

Dos cabillaud → brochette cabillaud

📊 MODULE — INVENTAIRE

✅ Saisie :

Poids restant OU

CA TTC

✅ Calcul :

Poids vendu

CA HT

Marge

MAJ stock réel

📌 Journal quotidien créé :

CA théorique

CA réel

Achats

Marge brute

✅ Bouton validation → stock OK

🐟 MODULE — TRAÇABILITÉ

Repose sur :

LOT

FIFO

Journal mouvements

Informations clés gérées :

Nom latin

Zone

Sous-zone

Engin

Allergenes

Photo étiquette sanitaire

QR code lot

✅ Canonisation automatique

FAO → format unique

Engin → format normalisé

🏷️ MODULE — ÉTIQUETTES

✅ Génération conforme

Nom du produit

Nom latin

Zone / sous-zone

Engin

Allergènes

Origine

Tarif

✅ Export :

Evolis

Excel

📊 MODULE — TABLEAU DE BORD

✅ Données clés :

CA

Achats

Marge %

Valeur stock

Rotation

Perte

Rendement transformation

✅ IDENTIFIANTS (LOT)

Format automatique :

AAAA MM JJ HH MM SS – index
(ex : 20251108-142311-03)

🔗 QR code → page info lot

🎯 OBJECTIFS FINAUX

Ultra fluide rayon

Multi-magasin

Multi-rayon

Traçabilité FIFO béton

Étiquettes propres

Valeur stock précise

Marge parfaitement suivie

Prêt à industrialiser

✅ Feuille de route

🟢 FAIT
✔ Articles
✔ Fournisseurs
✔ Achats manuels
✔ Autofill traçabilité
✔ LOT auto
✔ QR code ligne
✔ Photo sanitaire (upload)
✔ Convert → BL → stock FIFO
✔ Transformations (partiel)
✔ Inventaire
✔ Étiquettes Excel
✔ Auth multi-magasin

🟡 EN COURS
⏳ Import criée
⏳ Import PDF BL
⏳ Traitement OCR étiquette

🔴 À VENIR
⬜ Planning production
⬜ Statistiques avancées
⬜ Ventilation FE / FB
⬜ Connecteur Pesage

✅ Conclusion

Outil dédié poissonnerie / marée
→ Productivité x3
→ Traçabilité béton
→ Adapté GMS ou indépendant
→ Conçu pour évoluer
📁 STRUCTURE FIREBASE – RÉFÉRENCE OFFICIELLE
/af_map/{fournisseurCode__refFournisseur}
    fournisseurCode: string
    fournisseurNom: string
    refFournisseur: string
    plu: string
    designationInterne: string
    aliasFournisseur: string
    nomLatin: string
    zone: string
    sousZone: string
    methode: string
    allergenes: string
    engin: string
    updatedAt: Timestamp

/articles/{plu}
    plu: string
    designation: string
    nomLatin: string
    zone: string
    sousZone: string
    engin: string
    allergenes: string
    categorie: string
    … autre metadata

/achats/{achatId}
    date: Timestamp
    fournisseurCode: string
    fournisseurNom: string
    designationFournisseur: string
    type: string    ("commande" | "BL")
    statut: string  ("new" | "received")
    montantHT: number
    montantTTC: number
    totalKg: number
    createdAt: Timestamp
    updatedAt: Timestamp

/achats/{achatId}/lignes/{lineId}
    refFournisseur: string
    plu: string
    designation: string
    designationInterne: string
    nomLatin: string
    zone: string
    sousZone: string
    engin: string
    allergenes: string

    poidsKg: number          (criee)
    colis: number            (manuelle)
    poidsColisKg: number     (manuelle)
    poidsTotalKg: number     (manuelle)
    prixHTKg: number
    prixKg: number           (manuelle)
    montantHT: number
    montantTTC: number

    fao: string              (ex: "FAO27 VIII")
    lot: string              (ex: "20251110120503-03")
    qr_url: base64 or string
    qr_scanned: bool
    qr_scan_date: Timestamp
    photo_url: string

    received: bool
    createdAt: Timestamp
    updatedAt: Timestamp

/stock_movements/{docId}
    date: Timestamp
    type: "in" | "out"
    achatId: string
    ligneId: string
    plu: string
    lot: string
    poidsKg: number
    prixKg: number
    montantHT: number
✅ RÈGLE D’IMPORT – MAPPING CRIÉE

Lors d’un import CRIÉE :
→ On place les données dans /achats/{id}/lignes

Champs obligatoires à écrire :

Champ	Source
refFournisseur	colonne CRIÉE
plu	lookup AF_MAP
designation	CRIÉE
designationInterne	AF_MAP ou CRIÉE
nomLatin	CRIÉE
zone	CRIÉE
sousZone	CRIÉE
engin	CRIÉE
poidsKg	CRIÉE
prixHTKg	CRIÉE
totalHT	CRIÉE
fao	format : FAO{zone} {sousZone}

Champs non encore assignés (remplis plus tard) :

colis

poidsColisKg

poidsTotalKg

prixKg

montantHT (si conversion prix × poids)

Champs gérés automatiquement (plus tard) :

lot

qr_url

received (lors conversion en BL)

✅ AF_MAP — STANDARD
🔑 ID DOC
{fournisseurCode}__{refFournisseur}
Pas d’espace, pas de slash → déjà normalisé
Exemple
81268__33090
Structure
{
  fournisseurCode: "81268",
  fournisseurNom: "criee st gilles croix de vie",
  refFournisseur: "33090",
  plu: "3591",
  designationInterne: "MAIGRE COMMUN",
  nomLatin: "Argyrosomus regius",
  zone: "27",
  sousZone: "VIII",
  methode: "",
  allergenes: "",
  engin: "...",
  updatedAt: timestamp
}
✅ On conserve les lignes même si plu="" pour mappage futur

✅ PROCESS GLOBAL
1️⃣ Import AF_MAP

Convertir Excel → JSON

Import via :id = `${fournisseurCode}__${refFournisseur}`
2️⃣ Import CRIÉE

Lire tableau

Calcul clé AF_MAP

Hydrate :

plu

designationInterne

nomLatin

zone / sousZone / engin

Stock → /achats/{id}/lignes

3️⃣ Consultation Achat

Page display → OK

AF bouton → re-mappage manuel si besoin

4️⃣ Conversion → BL

Ajout :

lot auto

QR

stock_movements

✅ BONNES PRATIQUES

✅ AF_MAP minimal
plu
designationInterne
nomLatin
zone
sousZone
engin
✅ CRIÉE = source traça

nomLatin

zone

sousZone

engin

prix HT/kg

kg total

✅ Lots générés uniquement en BL

✅ Totaux mis à jour côté achat (header + lignes)

✅ POUR LES FUTURS IMPORTS
Structuration identique :

SCAPMARÉE

ANGELO

SOGELMER

→ On respecte :

En tête :
/achats
Lignes sous-doc
/achats/{id}/lignes/{lineId}
Avec le même schéma.

✅ GARANTI COMPATIBILITÉ avec tout le workflow :
AFFICHAGE → LECTURE → MODIFICATION → STOCK

✅ CHAMPS MINIMUM POUR UNE LIGNE VALIDÉE
plu
designation
nomLatin
zone
sousZone
engin
prixHTKg
poidsKg
totalHT
Optionnels :
allergenes
designationInterne
fao
On reconstruira toujours :
fao = `FAO${zone} ${sousZone}`
