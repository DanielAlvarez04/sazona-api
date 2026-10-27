import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UnitCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  convertQuantity,
  toQuantity,
  unitDefinition,
  unitLabel,
} from './units';

export interface IngredientUnitRef {
  id: string;
  name: string;
  baseUnit: UnitCode;
}

/**
 * Convierte cantidades a la unidad base de un ingrediente.
 *
 * - Misma dimensión (masa, volumen, conteo): factor fijo del sistema.
 * - Dimensión distinta: exige una `IngredientEquivalence` explícita, directa
 *   o inversa. Si no existe, la operación falla con 400: nunca se inventa una
 *   equivalencia (`plan.md` §6.2).
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

    if (!unit || unit === ingredient.baseUnit) {
      return toQuantity(value);
    }

    const source = unitDefinition(unit);
    const target = unitDefinition(ingredient.baseUnit);

    if (source.dimension === target.dimension) {
      return convertQuantity(value, unit, ingredient.baseUnit);
    }

    const direct = await this.prisma.ingredientEquivalence.findFirst({
      where: {
        ingredientId: ingredient.id,
        fromUnit: unit,
        toUnit: ingredient.baseUnit,
      },
    });

    if (direct) {
      return toQuantity(value.times(direct.factor));
    }

    const inverse = await this.prisma.ingredientEquivalence.findFirst({
      where: {
        ingredientId: ingredient.id,
        fromUnit: ingredient.baseUnit,
        toUnit: unit,
      },
    });

    if (inverse) {
      return toQuantity(value.dividedBy(inverse.factor));
    }

    throw new BadRequestException(
      `${ingredient.name}: falta la equivalencia entre ${unitLabel(unit)} y ${unitLabel(
        ingredient.baseUnit,
      )}`,
    );
  }
}
