/**
 * Utilidades de SKU compartidas por inventario y catálogo.
 *
 * El prefijo se deriva del nombre de la categoría para que los códigos sean
 * legibles: "Frutas y verduras" → FVE (inventario) o FV (catálogo).
 */

const STOP_WORDS = new Set([
  'y',
  'e',
  'o',
  'de',
  'del',
  'para',
  'con',
  'la',
  'el',
  'los',
  'las',
  'en',
  'al',
]);

/**
 * Iniciales de las primeras palabras significativas del nombre.
 *
 * Omite artículos y preposiciones. Si hay menos palabras que letras pedidas,
 * completa con las siguientes letras de la última palabra y, como último
 * recurso, con las letras restantes del nombre sin espacios.
 */
export function categoryInitials(name: string, length = 3): string {
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim();

  const words = plain
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word.toLowerCase()));

  let prefix = words
    .slice(0, length)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  // Menos palabras que letras: se toman más letras de la última.
  if (prefix.length < length) {
    const lastWord = (words[words.length - 1] ?? '').toUpperCase();
    let index = 1;

    while (prefix.length < length && index < lastWord.length) {
      prefix += lastWord[index];
      index += 1;
    }
  }

  // Último recurso (nombres muy cortos o símbolos).
  if (prefix.length < length) {
    for (const char of plain.replace(/\s/g, '').toUpperCase()) {
      if (prefix.length >= length) break;
      prefix += char;
    }
  }

  return prefix.slice(0, length).padEnd(length, 'X');
}

/**
 * Sufijo alfabético de una presentación: 0 → A, 25 → Z, 26 → AA.
 *
 * Se usa para el SKU de cada presentación (`XVA101A`, `XVA101B`, …).
 */
export function alphabetSuffix(index: number): string {
  let position = Math.max(0, Math.trunc(index));
  let suffix = '';

  do {
    suffix = String.fromCharCode(65 + (position % 26)) + suffix;
    position = Math.floor(position / 26) - 1;
  } while (position >= 0);

  return suffix;
}
