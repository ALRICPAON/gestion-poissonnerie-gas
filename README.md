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

## 👛 TRANSFORMATIONS

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

## 📆 EXPORT ÉTIQUETTES

- Préparation d'étiquettes conformes (type Evolis).
- Normalisation automatique (zone, engin, élevé/décongelé, allergènes).
- Export en Excel + impression possible.

---

## 🔐 AUTHENTIFICATION / MULTI-MAGASINS

- Chaque utilisateur (magasin) a ses propres données Firebase.
- Login / mot de passe = accès isolé à ses fiches, stocks, etc.

---

## 🧠 Objectif final

> Outil duplicable, fluide, multi-rayon, avec base traçable FIFO, exportable, propre, rapide à utiliser sur le terrain.

✅ Historique GitHub = base unique de vérité.

---

📅 **Document mis à jour automatiquement le 2025-11-08 à partir des échanges avec l’utilisateur Alric.**


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

📌 Pense-bête : bien importer les modules `firebase/firestore.js` (⚠️ pas `firestore-lite.js`) pour éviter les erreurs de type "Expected CollectionReference…"

📅 Mise à jour le 2025-11-08
