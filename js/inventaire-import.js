/******************************************************
 * IMPORT VENTES CA TTC POUR INVENTAIRE
 * Nettoyage EAN + agrégation CA → localStorage
 *****************************************************/
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";

const fileInput = document.querySelector("#fileCA");
const btnImport = document.querySelector("#btnImport");
const importStatus = document.querySelector("#importStatus");

/******************************************************
 * EXTRACTION EAN : On récupère le premier EAN (13 chiffres)
 *****************************************************/
function extractEAN(text) {
  if (!text) return null;

  // Normaliser : convertir en string, remplacer caractères invisibles
  const str = String(text).replace(/\u00A0/g,' ').replace(/\r/g,' ').replace(/\t/g,' ');

  // Cherche 13 chiffres d’affilée (un vrai EAN)
  const match = str.match(/(\d{13})/);
  if (match && match[1]) return match[1];

  // Si pas trouvé 13, chercher une séquence plus courte et padding (sécurité)
  const short = str.match(/(\d{8,12})/);
  if (short && short[1]) {
    return short[1].padStart(13, "0"); // pad leading zeros si nécessaire
  }

  return null;
}

/******************************************************
 * Convertit une valeur en nombre
 *****************************************************/
function toNum(x) {
  if (x == null) return 0;
  return parseFloat(String(x).replace(",", ".").replace(/\s/g, "")) || 0;
}

/******************************************************
 * IMPORT CA → AGRÉGATION PAR EAN
 *
 * NOTE : on commence la lecture à la ligne 19 (i = 18)
 *****************************************************/
btnImport.addEventListener("click", async () => {
  // 🧹 1️⃣ On efface l'ancien import CA si présent
  localStorage.removeItem("inventaireCA");
  // et on supprime aussi les versions datées par sécurité (optionnel)
  // (ne pas supprimer si tu veux conserver d'autres dates)
  // for (let k in localStorage) if (k.startsWith("inventaireCA_")) localStorage.removeItem(k);

  const file = fileInput.files[0];
  if (!file) {
    alert("Sélectionne un fichier CA !");
    return;
  }

  importStatus.textContent = "⏳ Lecture du fichier…";

  // Lecture fichier Excel
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // header:1 pour obtenir tableau de lignes
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const ventes = {}; // ean -> CA TTC total

  // Parcours des lignes du fichier
  // On démarre à i = 18 (ligne 19 en notation Excel 1-based)
  for (let i = 18; i < rows.length; i++) {
    const row = rows[i] || [];
    const cellR = row[17]; // colonne R : EAN + texte
    const cellT = row[19]; // colonne T : CA TTC

    if (!cellR) continue;
    const ean = extractEAN(cellR);
    if (!ean) continue;

    const ca = toNum(cellT);
    if (!ventes[ean]) ventes[ean] = 0;
    ventes[ean] += ca;
  }

  // Sauvegarde dans localStorage
  localStorage.setItem("inventaireCA", JSON.stringify(ventes));

  // Mise à jour UI
  importStatus.textContent = "Import terminé !";

  // Déclenche le rechargement auto dans inventaire.js
  window.dispatchEvent(new Event("inventaireCAReady"));

  console.log("VENTES :", ventes);
});
