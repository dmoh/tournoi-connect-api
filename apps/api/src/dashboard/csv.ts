/** Séparateur attendu par Excel en français. */
const SEPARATOR = ';';

/**
 * Cellule CSV : guillemets doublés, cellule entre guillemets si besoin, et
 * apostrophe devant une cellule qui commencerait une formule (=, +, -, @,
 * tabulation, retour chariot), contre l'injection de formules à l'ouverture.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Marque d'ordre des octets : Excel lit alors le fichier en UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** Fichier CSV : BOM UTF-8 (accents corrects dans Excel), lignes CRLF. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [header, ...rows].map((row) =>
    row.map(csvCell).join(SEPARATOR),
  );
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Montant en euros avec virgule décimale (« 12,50 »). */
export const euros = (cents: number) =>
  (cents / 100).toFixed(2).replace('.', ',');
