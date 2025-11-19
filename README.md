🐟 README OFFICIEL – GESTION POISSONNERIE (Version Web + Firebase)

Dernière mise à jour : 19 novembre 2025

📘 1. Vision & Architecture

Application Web complète, dédiée au rayon Marée / Poissonnerie en GMS ou commerce indépendant.
Objectif : productivité x3, traçabilité béton, gestion FIFO, marges maîtrisées, étiquettes sanitaires professionnelles, inventaires fiables, et workflows modernes.

✔ Full web
✔ Multi-magasin
✔ Authentification sécurisée
✔ Firebase (Auth, Firestore, Storage)
✔ Import Excel / PDF / QR / Photo
✔ Architecture modulaire
✔ Duplicable pour n’importe quel magasin

🗂️ 2. Structure des Modules
📦 Articles

📌 Fichiers : load-articles.js, submit-article.js, edit-article.js

Champs disponibles :

Champ	Description
PLU	Identifiant principal
Désignation	Nom produit
Nom latin	Traçabilité
Zone / Sous-zone	FAO
Engin	Méthode de pêche
Allergènes	Mention obligatoire
Unité	€/kg ou pièce
Catégorie	Trad / FE / LS
EAN	13 chiffres → essentiel pour inventaire
Rayon	trad (défaut), fe, ls

Fonctions :

CRUD complet

Recherche instantanée

Normalisation FAO / Engins

Autofill lors des achats

EAN ajouté automatiquement à la base (pour inventaire)

📦 Fournisseurs

CRUD complet

Mapping AF_MAP (clé : code__refFournisseur)

Permet mappage automatique lors des imports BL/Criée

Structure AF_MAP :

fournisseurCode
fournisseurNom
refFournisseur
plu
designationInterne
nomLatin
zone
sousZone
engin
allergenes
updatedAt

🧾 3. Achats (manuels + imports)
Fonctionnalités :

Création achat

Saisie lignes simple / rapide

Autofill traçabilité depuis Article

Conversion en BL → création LOT + mouvement FIFO

QR code ligne

Upload photo étiquette sanitaire

Totaux automatiques

Détection des erreurs (poids, prix, etc.)

Import Criée / Fournisseurs

Import XLSX (colonnes personnalisées)

Mappage automatique via AF_MAP

Normalisation FAO / Engins

Ajout automatique PLU + nom latin + zone + engin

Calcul montant HT

Enregistrement dans /achats/{id}/lignes

Informations stockées pour chaque ligne
plu
designation
nomLatin
zone
sousZone
engin
allergenes
poidsKg
prixHTKg
montantHT
lotId
photo_url
qr_url
received (bool)

🧊 4. L O T S – cœur du FIFO

Chaque ligne de BL génère un lot, créé dans Firestore :

Collection /lots/{lotId} :

Champ	Description
plu	identifiant produit
designation	nom article
poidsInitial	kg reçus
poidsRestant	kg disponibles
prixAchatKg	prix HT/kg
dlc	date limite
zone / sousZone	FAO
engin	pêche
achatId	ID de l’achat
ligneId	Ligne d’achat
closed	true si épuisé
updatedAt	trace

→ Tous les calculs stock/marge/inventaire passent par les lots.

📦 5. Stock (page dédiée)

📌 Fichier : stock.js

Caractéristiques du stock :

Calcul PMA = prix moyen d’achat basé sur les lots restants

Détection catégorie (TRAD/FE/LS)

PV conseillé → en fonction de la marge

PV réel modifiable → sauvegardé dans stock_articles

Couleur en fonction DLC

Totaux TRAD / FE / LS

Valeur stock HT / TTC

Mouvements FIFO utilisés pour transformations & inventaire

Structure /stock_articles/{PLU_xxxx} :
pvTTCreel
poids (kg)
updatedAt


⚠ Le stock théorique NE vient pas de stock_articles mais de /lots.

🧮 6. INVENTAIRE (version finale)

📌 Fichiers : inventaire.js + inventaire-import.js

🟦 Import CA TTC (Excel)

Lecture EAN en colonne R

Extraction automatique du premier EAN (13 chiffres)

Lecture CA TTC en colonne T

Agrégation : localStorage["inventaireCA"] = {ean: ca}

Recharge auto de l’inventaire

🟧 Inventaire (fonctionnement)

Sélection d’une date obligatoire

Chargement des lots ouverts → stock théorique

Lecture CA TTC par EAN → calcul poids vendu

Calcul automatique :

Élément	Formule
Poids vendu	CA TTC / prix TTC réel
Stock réel	Stock théorique − Poids vendu (peut être négatif)
Écart	Stock réel − Stock théorique
🟩 Saisie directe type Excel

colonne "Stock réel" = <input type="number">

recalcul en direct

négatifs acceptés (régulations)

🟥 Validation inventaire

Effectue :

✔ FIFO → applyInventory(plu, stockReel)

Consomme les lots (plus vieux en premier)

Met à jour les poidsRestant

Ferme les lots vides

✔ Mise à jour stock_articles

Recalcul poids total restant (kg) et mise à jour updatedAt

✔ Enregistrement de la valeur stock HT dans journal_inventaires/{date}

Pour tableau de bord futur.

Structure :

{
  date,
  valeurStockHT,
  createdAt
}

🧬 7. Transformations (source → produit fini)

Fonctionnement :

Sélection de 1+ sources

Déduction FIFO

Rendement (%) appliqué

Création lot de produit fini

CUMP recalculé

Stock auto mis à jour

Journal traçabilité consigné

🧭 8. Traçabilité (FAO / Engin / Lot / QR)

Chaque mouvement (achat / inventaire / transformation) repose sur LOT

QR code pointant vers fiche traçabilité web

Canonisation FAO & Engin :

FAO27VIII → FAO 27 VIII

CHALUT OTB/Chalut → Chalut OTB

Photo étiquette sanitaire enregistrée dans Storage

🏷️ 9. Étiquettes (Evolis & Excel)

Lecture automatique lot + article

Normalisation FAO / Engin

Format exact Evolis (colonnes officielles)

Export XLSX

Prix TTC (réel) utilisé

Étiquettes prêtes à imprimer

📊 10. Tableau de bord (à venir)

Sera alimenté automatiquement par :

journal_inventaires

achats / transformations / ventes

valeur stock HT

marges TRAD / FE / LS

rotation stock

pertes inventaires (écarts)

CA LS / FE / Trad

🔐 11. Authentification & Multi-magasins

Firebase Auth email/mot de passe

Redirection automatique des pages protégées

Multi-magasins = 1 base Firestore par magasin

Fonctionnement totalement isolé

Login → accès direct aux modules perso

🧱 12. Structure Firestore (finale)
/articles/{plu}

Toutes les infos catalogue (traça + ean + rayon)

/fournisseurs/{code}

Info fournisseur

/af_map/{code__ref}

Mapping fournisseur → article interne

/achats/{achatId}

Détails achat + sous-collection /lignes

/lots/{lotId}

FIFO + traçabilité + quantités

/stock_articles/PLU_xxxx

PV réel + poids restant (calculé)

/stock_movements/{id}

Entrées / sorties FIFO

/journal_inventaires/{date}

Valeur stock HT du jour

🟢 13. Fonctionnement global
ACHATS → LOTS → STOCK → INVENTAIRE → JOURNAL → TABLEAU DE BORD
        ↘ TRANSFORMATIONS ↗

🧭 14. Feuille de route
🟢 Déjà fait

✔ Articles
✔ Fournisseurs
✔ AF_MAP
✔ Achats manuels
✔ Import criée partiel
✔ Photo sanitaire
✔ QR codes
✔ LOTS FIFO
✔ Stock (PMA + PV réel)
✔ Inventaire (CA + poids + FIFO + journaux)
✔ Étiquettes Evolis
✔ Auth multi-magasin
✔ Base propre (articles avec EAN & rayon)

🟡 En cours

⏳ Tracabilité complète (fiche lot + QR)
⏳ Imports PDF BL
⏳ Import Excel centrale Scapmarée / Sogelmer

🔴 À venir

⬜ OCR automatique
⬜ Préparation / planning production
⬜ Stats avancées (rotation, marge, pertes)
⬜ Connecteur balance / pesée
⬜ Export PDF standardisé (fiche traça)

🎯 15. Conclusion

Tu as désormais :
✔ une architecture propre
✔ un inventaire pro (CA + FIFO)
✔ un stock fiable
✔ une traçabilité impeccable
✔ une base duplicable pour n’importe quel Leclerc
✔ une structure maîtrisée pour évoluer vers une vraie web-app
