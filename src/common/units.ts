import { BadRequestException } from '@nestjs/common';
import { Prisma, UnitCode } from '@prisma/client';

/**
 * Catálogo de unidades soportadas.
 *
 * Es fijo y no editable: las relaciones dentro de una misma dimensión son
 * estándar (1 kg = 1000 g, 1 tbsp = 15 ml, 1 docena = 12 piezas). Las
 * equivalencias entre dimensiones distintas (masa ↔ volumen ↔ conteo) **sí**
 * son específicas de cada ingrediente y se guardan en
 * `IngredientEquivalence`; nunca se deducen automáticamente (`plan.md` §6.2).
 */
export type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT';

export interface UnitDefinition {
  code: UnitCode;
  /** Símbolo corto que acompaña a las cantidades (g, tsp, pieza). */
  label: string;
  /** Nombre completo en español, usado en el catálogo de configuración. */
  name: string;
  dimension: UnitDimension;
  /** Cuántas unidades base de su dimensión representa 1 unidad. */
  factor: string;
}

export const QUANTITY_SCALE = 4;
export const MONEY_SCALE = 2;

export const UNITS: readonly UnitDefinition[] = [
  // Masa (base: gramo)
  { code: UnitCode.MG, label: 'mg', name: 'miligramo', dimension: 'MASS', factor: '0.001' },
  { code: UnitCode.G, label: 'g', name: 'gramo', dimension: 'MASS', factor: '1' },
  { code: UnitCode.KG, label: 'kg', name: 'kilogramo', dimension: 'MASS', factor: '1000' },
  { code: UnitCode.OZ, label: 'oz', name: 'onza de masa', dimension: 'MASS', factor: '28.349523125' },
  { code: UnitCode.LB, label: 'lb', name: 'libra', dimension: 'MASS', factor: '453.59237' },

  // Volumen (base: mililitro)
  { code: UnitCode.ML, label: 'ml', name: 'mililitro', dimension: 'VOLUME', factor: '1' },
  { code: UnitCode.L, label: 'L', name: 'litro', dimension: 'VOLUME', factor: '1000' },
  { code: UnitCode.TSP, label: 'tsp', name: 'cucharadita estándar', dimension: 'VOLUME', factor: '5' },
  { code: UnitCode.TBSP, label: 'tbsp', name: 'cucharada estándar', dimension: 'VOLUME', factor: '15' },
  { code: UnitCode.CUP, label: 'cup', name: 'taza métrica', dimension: 'VOLUME', factor: '250' },
  { code: UnitCode.FL_OZ, label: 'fl oz', name: 'onza líquida estadounidense', dimension: 'VOLUME', factor: '29.5735295625' },
  { code: UnitCode.GAL, label: 'gal', name: 'galón estadounidense', dimension: 'VOLUME', factor: '3785.411784' },

  // Conteo (base: pieza)
  { code: UnitCode.UNIT, label: 'pieza', name: 'pieza', dimension: 'COUNT', factor: '1' },
  { code: UnitCode.HALF_PIECE, label: '½ pieza', name: 'media pieza', dimension: 'COUNT', factor: '0.5' },
  { code: UnitCode.PAIR, label: 'par', name: 'par', dimension: 'COUNT', factor: '2' },
  { code: UnitCode.HALF_DOZEN, label: '½ docena', name: 'media docena', dimension: 'COUNT', factor: '6' },
  { code: UnitCode.DOZEN, label: 'docena', name: 'docena', dimension: 'COUNT', factor: '12' },
];

export const UNIT_CODES = UNITS.map((unit) => unit.code);

const UNIT_MAP = new Map<UnitCode, UnitDefinition>(
  UNITS.map((unit) => [unit.code, unit]),
);

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === 'string' && UNIT_MAP.has(value as UnitCode);
}

export function unitDefinition(unit: UnitCode): UnitDefinition {
  const definition = UNIT_MAP.get(unit);

  if (!definition) {
    throw new BadRequestException(`Unidad desconocida: ${unit}`);
  }

  return definition;
}

export function unitLabel(unit: UnitCode): string {
  return unitDefinition(unit).label;
}

/**
 * Convierte una cantidad entre unidades de la misma dimensión.
 * Redondea a 4 decimales (escala de la base de datos).
 */
export function convertQuantity(
  value: Prisma.Decimal.Value,
  from: UnitCode,
  to: UnitCode,
): Prisma.Decimal {
  const quantity = new Prisma.Decimal(value);

  if (from === to) {
    return quantity.toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  }

  const source = unitDefinition(from);
  const target = unitDefinition(to);

  if (source.dimension !== target.dimension) {
    throw new BadRequestException(
      `No se puede convertir ${source.label} a ${target.label} sin una equivalencia del ingrediente`,
    );
  }

  return quantity
    .times(source.factor)
    .dividedBy(target.factor)
    .toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Normaliza una cantidad a la escala de la base de datos. */
export function toQuantity(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(
    QUANTITY_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/** Normaliza un importe monetario a 2 decimales (redondeo bancario explícito). */
export function toMoney(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(
    MONEY_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}
