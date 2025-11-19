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

  const str = String(text);

  // Cherche 13 chiffres d’affilée (un vrai EAN)
  const match = str.match(/(\d{13})/);
  if (!match) return null;

  return match[1]; // renvoie l’EAN net et propre
}

/******************************************************
 * Convertit une valeur en nombre
 *****************************************************/
function toNum(x) {
  if (!x) return 0;
  return parseFloat(String(x).replace(",", ".")) || 0;
}

/******************************************************
 * IMPORT CA → AGRÉGATION PAR EAN
 *****************************************************/
btnImport.addEventListener("click", async () => {

  // 🧹 1️⃣ On efface l'ancien import CA si présent
  localStorage.removeItem("inventaireCA");

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
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const ventes = {}; // ean -> CA TTC total

  // Parcours des lignes du fichier
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i][17]; // colonne R (EAN + texte)
    const t = rows[i][19]; // colonne T (CA TTC)

    const ean = extractEAN(r);
    if (!ean) continue;

    const ca = toNum(t);
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
