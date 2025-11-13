/**************************************************
 * PARSE SOGELMER – Version béton anti-entête
 **************************************************/
export function parseSogelmer(text) {

  const rows = [];
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // ✔ Regex stricte : vrai code article seulement
  const isArticleCode = s =>
    /^[A-Z]{3,6}[A-Z0-9/]{1,6}$/.test(s) &&
    !/CLIENT|SOGELMER|STEF|PAGE|DATE|POIDS|FR|CE|BL|TARIF/i.test(s);

  let i = 0;

  while (i < lines.length) {
    const L = lines[i];

    if (!isArticleCode(L)) {
      i++;
      continue;
    }

    // — Début d’un article —
    const refF = L;
    const designation = (lines[i + 1] || "").trim();

    const colis = parseFloat((lines[i + 2] || "").replace(",", "."));
    const poidsColisKg = parseFloat((lines[i + 3] || "").replace(",", "."));
    const poidsTotalKg = parseFloat((lines[i + 4] || "").replace(",", "."));
    const uv = (lines[i + 5] || "").trim();
    const lot = (lines[i + 6] || "").trim();

    let prixKg = 0;
    if ((lines[i + 7] || "").includes("€"))
      prixKg = parseFloat(lines[i + 7].replace("€", "").replace(",", "."));

    let montantHT = 0;
    if ((lines[i + 8] || "").includes("€"))
      montantHT = parseFloat(lines[i + 8].replace("€", "").replace(",", "."));

    // Ligne bio
    const bio = (lines[i + 10] || "").trim();

    // — Nom latin —
    let nomLatin = "";
    const latin = bio.match(/^([A-Z][a-z]+(?: [a-z]+)*)/);
    if (latin) nomLatin = latin[1];

    // — FAO —
    let zone = "";
    let sousZone = "";
    let fao = "";

    const faoMatch = bio.match(/FAO\s*([0-9]{1,3})\s*([IVX]*)/i);
    if (faoMatch) {
      zone = `FAO ${faoMatch[1]}`;
      sousZone = faoMatch[2] || "";
      if (/autres ss zones/i.test(bio))
        sousZone += " & AUTRES SS ZONES";
      fao = `${zone} ${sousZone}`.trim();
    }

    // — Engin —
    let engin = "";
    const engMatch = bio.match(/Chalut|Ligne|Filet|Mail|FILTS/gi);
    if (engMatch) engin = engMatch[0];

    rows.push({
      refFournisseur: refF,
      designation,
      colis,
      poidsColisKg,
      poidsTotalKg,
      uv,
      lot,
      prixKg,
      montantHT,
      nomLatin,
      zone,
      sousZone,
      engin,
      fao
    });

    i += 11;
  }

  console.log("📦 Lignes SOGELMER extraites:", rows);
  return rows;
}
