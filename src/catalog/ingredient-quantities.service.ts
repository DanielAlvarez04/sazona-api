import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuantityConverter } from '../common/quantity-converter.service';

export interface IngredientQuantityInput {
  ingredientId: string;
  quantity: number | string;
  unit?: UnitCode;
}

/**
 * Valida ingredientes de la organización y normaliza sus cantidades a la
 * unidad base. Se usa en recetas y en el consumo de extras.
 */
@Injectable()
export class IngredientQuantitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantities: QuantityConverter,
  ) {}

  async resolve(organizationId: string, input: IngredientQuantityInput[]) {
    const seen = new Set<string>();
    const result: Array<{
      ingredientId: string;
      quantity: Prisma.Decimal;
    }> = [];

    for (const item of input) {
      if (seen.has(item.ingredientId)) {
        throw new BadRequestException(
          'Un ingrediente no puede repetirse en la misma receta o extra',
        );
      }
      seen.add(item.ingredientId);

      const ingredient = await this.prisma.ingredient.findFirst({
        where: { id: item.ingredientId, organizationId },
      });

      if (!ingredient) {
        throw new NotFoundException('Ingrediente no encontrado');
      }

      if (!ingredient.isActive) {
        throw new BadRequestException(
          `El ingrediente "${ingredient.name}" está desactivado`,
        );
      }

      const quantity = await this.quantities.toBaseUnit(
        ingredient,
        item.quantity,
        item.unit,
      );

      if (quantity.lte(0)) {
        throw new BadRequestException(
          `La cantidad de "${ingredient.name}" debe ser mayor que cero`,
        );
      }

      result.push({ ingredientId: ingredient.id, quantity });
    }

    return result;
  }
}
