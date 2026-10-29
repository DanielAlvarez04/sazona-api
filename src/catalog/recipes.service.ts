import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fromCanonicalQuantity } from '../common/units';
import { IngredientQuantitiesService } from './ingredient-quantities.service';
import { UpsertRecipeDto } from './dto/recipe.dto';

const recipeInclude = {
  ingredients: {
    orderBy: { ingredient: { name: 'asc' } },
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          baseUnit: true,
          displayUnit: true,
          currentStock: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredientQuantities: IngredientQuantitiesService,
  ) {}

  async list(organizationId: string | null, productId: string) {
    await this.getProduct(organizationId, productId);

    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId, productId },
      include: recipeInclude,
      orderBy: { variantId: 'asc' },
    });

    return recipes.map((recipe) => ({
      ...this.withDisplayUnits(recipe),
      // Sin ingredientes no se puede calcular el consumo (`plan.md` §6.3).
      canComputeConsumption: recipe.ingredients.length > 0,
    }));
  }

  async upsert(
    organizationId: string | null,
    productId: string,
    dto: UpsertRecipeDto,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const variantId = dto.variantId ?? null;

    let variantName: string | undefined;

    if (variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: variantId, productId: product.id },
        select: { name: true },
      });

      if (!variant) {
        throw new NotFoundException(
          'La variante no pertenece al producto de la receta',
        );
      }

      variantName = variant.name;
    }

    const ingredients = await this.ingredientQuantities.resolve(
      organizationId,
      dto.ingredients,
    );

    const name =
      dto.name?.trim() ||
      `${product.name}${variantName ? ` — ${variantName}` : ''}`;

    const existing = await this.prisma.recipe.findFirst({
      where: { organizationId, productId: product.id, variantId },
    });

    const recipeId = await this.prisma.$transaction(async (tx) => {
      let id: string;

      if (existing) {
        await tx.recipeIngredient.deleteMany({
          where: { recipeId: existing.id },
        });

        const updated = await tx.recipe.update({
          where: { id: existing.id },
          data: { name, isActive: dto.isActive ?? true },
        });

        id = updated.id;
      } else {
        const created = await tx.recipe.create({
          data: {
            organizationId,
            productId: product.id,
            variantId,
            name,
            isActive: dto.isActive ?? true,
          },
        });

        id = created.id;
      }

      await tx.recipeIngredient.createMany({
        data: ingredients.map((ingredient) => ({
          recipeId: id,
          ingredientId: ingredient.ingredientId,
          quantity: ingredient.quantity,
        })),
      });

      return id;
    });

    return this.prisma.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      include: recipeInclude,
    }).then((recipe) => this.withDisplayUnits(recipe));
  }

  async remove(
    organizationId: string | null,
    productId: string,
    recipeId: string,
  ) {
    await this.getProduct(organizationId, productId);

    const recipe = await this.prisma.recipe.findFirst({
      where: { id: recipeId, productId, organizationId },
    });

    if (!recipe) {
      throw new NotFoundException('Receta no encontrada');
    }

    await this.prisma.recipe.delete({ where: { id: recipe.id } });

    return { ok: true };
  }

  /** Expresa las cantidades de la receta en la unidad visible del ingrediente. */
  private withDisplayUnits(
    recipe: Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>,
  ) {
    return {
      ...recipe,
      ingredients: recipe.ingredients.map((item) => ({
        ...item,
        quantity: fromCanonicalQuantity(
          item.quantity,
          item.ingredient.displayUnit,
        ),
        ingredient: {
          ...item.ingredient,
          currentStock: fromCanonicalQuantity(
            item.ingredient.currentStock,
            item.ingredient.displayUnit,
          ),
        },
      })),
    };
  }

  private async getProduct(organizationId: string | null, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true, name: true },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }
}
