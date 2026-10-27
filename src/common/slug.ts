import { randomBytes } from 'node:crypto';

/** Convierte un nombre libre en un slug ASCII seguro para URL. */
export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'negocio'
  );
}

/** Slug único por negocio; el sufijo aleatorio evita colisiones entre cafeterías. */
export function buildOrganizationSlug(name: string): string {
  return `${slugify(name)}-${randomBytes(3).toString('hex')}`;
}
