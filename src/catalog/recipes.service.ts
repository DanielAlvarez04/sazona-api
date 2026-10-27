import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngredientQuantitiesService } from './ingredient-quantities.service';
import { UpsertRecipeDto } from './dto/recipe.dto';

const recipeInclude = {
  variant: { select: { id: true, name: true } },
  ingredients: {
    orderBy: { ingredient: { name: 'asc' } },
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          baseUnit: true,
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

  async list(organizationId: string, productId: string) {
    await this.getProduct(organizationId, productId);

    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId, productId },
      include: recipeInclude,
      orderBy: { variantId: 'asc' },
    });

    return recipes.map((recipe) => ({
      ...recipe,
      // Sin ingredientes no se puede calcular el consumo (`plan.md` §6.3).
      canComputeConsumption: recipe.ingredients.length > 0,
    }));
  }

  async upsert(
    organizationId: string,
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
    });
  }

  async remove(
    organizationId: string,
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

  private async getProduct(organizationId: string, productId: string) {
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
