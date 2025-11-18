// submit-achat.js — VERSION NETTOYÉE
// -------------------------------------------------------------
// Ce fichier ne gère PLUS la création d'achats.
// Il ne sert qu’aux fonctions futures via formulaires éventuels.
// -------------------------------------------------------------

import { db } from "../js/firebase-init.js";
import {
  collection, doc, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("submit-achat.js chargé — création de commandes désactivée.");
