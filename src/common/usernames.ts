/**
 * Reglas compartidas de los nombres de usuario y del dominio del negocio.
 *
 * El usuario se guarda en minúsculas y puede ser local (`ana`) o con el
 * dominio del negocio (`ana@naranjapimienta.cafe`). El login acepta el usuario
 * tal cual lo escriba la persona porque se normaliza antes de consultar.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 120;
export const USERNAME_LOCAL_PATTERN = /^[a-z0-9._-]+$/;

/** Dominio con al menos dos etiquetas: `naranjapimienta.cafe`. */
export const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidDomain(value: string): boolean {
  return value.length >= 3 && value.length <= 80 && DOMAIN_PATTERN.test(value);
}

/** Acepta `ana` (cuentas antiguas) o `ana@naranjapimienta.cafe`. */
export function isValidUsername(value: string): boolean {
  if (
    value.length < USERNAME_MIN_LENGTH ||
    value.length > USERNAME_MAX_LENGTH
  ) {
    return false;
  }

  const parts = value.split('@');

  if (parts.length > 2) {
    return false;
  }

  if (!USERNAME_LOCAL_PATTERN.test(parts[0])) {
    return false;
  }

  return parts.length === 1 || isValidDomain(parts[1]);
}

/** Separa un nombre en nombre de pila y primer apellido (sin acentos). */
export function splitName(name: string): { first: string; surname: string } {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return { first: words[0] ?? '', surname: words[1] ?? '' };
}

/**
 * Usuarios propuestos para un nombre, en orden de preferencia:
 * `ana@dominio`, `a.perez@dominio`, `a.perez2@dominio`, ...
 */
export function usernameCandidates(name: string, domain: string | null): string[] {
  const { first, surname } = splitName(name);

  if (!first) {
    return [];
  }

  const suffix = domain ? `@${domain}` : '';
  const alt = surname ? `${first[0]}.${surname}` : first[0];
  const candidates = [`${first}${suffix}`];
  const altUsername = `${alt}${suffix}`;

  if (!candidates.includes(altUsername)) {
    candidates.push(altUsername);
  }

  for (let n = 2; n <= 9; n += 1) {
    candidates.push(`${alt}${n}${suffix}`);
  }

  return candidates;
}
