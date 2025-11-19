import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";

const fileInput = document.querySelector("#fileCA");
const btnImport = document.querySelector("#btnImport");
const importStatus = document.querySelector("#importStatus");

function extractEAN(text) {
  if (!text) return null;
  const digits = String(text).replace(/\D/g, "");
  return digits.length === 13 ? digits : null;
}

function toNum(x) {
  if (!x) return 0;
  return parseFloat(String(x).replace(",", ".")) || 0;
}

btnImport.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    alert("Sélectionne un fichier CA !");
    return;
  }

  importStatus.textContent = "⏳ Lecture du fichier…";

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const ventes = {}; // ean → CA TTC total

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i][17]; // colonne R
    const t = rows[i][19]; // colonne T
    const ean = extractEAN(r);
    if (!ean) continue;

    const ca = toNum(t);
    if (!ventes[ean]) ventes[ean] = 0;
    ventes[ean] += ca;
  }

  localStorage.setItem("inventaireCA", JSON.stringify(ventes));
  importStatus.textContent = "✅ Import CA terminé !";

  console.log("VENTES :", ventes);
});
