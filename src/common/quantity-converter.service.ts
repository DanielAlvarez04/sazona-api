import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UnitCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canonicalUnit,
  convertQuantity,
  toQuantity,
  unitDefinition,
  unitLabel,
} from './units';

export interface IngredientUnitRef {
  id: string;
  name: string;
  /** Unidad canónica de almacenamiento. */
  baseUnit: UnitCode;
  /** Unidad con la que el usuario captura las cantidades. */
  displayUnit: UnitCode;
}

/**
 * Convierte cantidades de la unidad visible a la unidad canónica del ingrediente.
 *
 * - Misma dimensión (masa, volumen, conteo): factor fijo del sistema.
 * - Dimensión distinta: exige una `IngredientEquivalence` explícita, directa
 *   o inversa. Las equivalencias se guardan entre unidades canónicas. Si no
 *   existe, la operación falla con 400: nunca se inventa una equivalencia
 *   (`plan.md` §6.2).
 */
@Injectable()
export class QuantityConverter {
  constructor(private readonly prisma: PrismaService) {}

  async toBaseUnit(
    ingredient: IngredientUnitRef,
    quantity: Prisma.Decimal.Value,
    unit?: UnitCode,
  ): Promise<Prisma.Decimal> {
    const value = new Prisma.Decimal(quantity);
    // Sin unidad explícita, la cantidad viene en la unidad visible.
    const fromUnit = unit ?? ingredient.displayUnit;

    if (fromUnit === ingredient.baseUnit) {
      return toQuantity(value);
    }

    const source = unitDefinition(fromUnit);
    const target = unitDefinition(ingredient.baseUnit);

    if (source.dimension === target.dimension) {
      return convertQuantity(value, fromUnit, ingredient.baseUnit);
    }

    // Equivalencia entre dimensiones: se busca siempre en unidades canónicas.
    const fromCanonical = canonicalUnit(fromUnit);
    const normalized = convertQuantity(value, fromUnit, fromCanonical);

    const direct = await this.prisma.ingredientEquivalence.findFirst({
      where: {
        ingredientId: ingredient.id,
        fromUnit: fromCanonical,
        toUnit: ingredient.baseUnit,
      },
    });

    if (direct) {
      return toQuantity(normalized.times(direct.factor));
    }

    const inverse = await this.prisma.ingredientEquivalence.findFirst({
      where: {
        ingredientId: ingredient.id,
        fromUnit: ingredient.baseUnit,
        toUnit: fromCanonical,
      },
    });

    if (inverse) {
      return toQuantity(normalized.dividedBy(inverse.factor));
    }

    throw new BadRequestException(
      `${ingredient.name}: falta la equivalencia entre ${unitLabel(fromUnit)} y ${unitLabel(
        ingredient.displayUnit,
      )}`,
    );
  }
}
