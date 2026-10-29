import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngredientQuantitiesService } from './ingredient-quantities.service';
import { fromCanonicalQuantity, toMoney } from '../common/units';
import {
  ComboComponentInputDto,
  CreateExtraDto,
  CreateProductDto,
  CreateVariantDto,
  ExclusionInputDto,
  ExtraIngredientInputDto,
  UpdateExtraDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';

const productListInclude = {
  category: { select: { id: true, name: true } },
  variants: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
  extras: { orderBy: { name: 'asc' } },
  // El POS necesita saber qué ingredientes se pueden quitar al tomar la comanda.
  ingredientExclusions: {
    include: {
      ingredient: {
        select: { id: true, name: true, baseUnit: true, displayUnit: true },
      },
    },
  },
  _count: { select: { recipes: true } },
  recipes: {
    select: { id: true, name: true, variantId: true, isActive: true },
    orderBy: { variantId: 'asc' },
  },
} satisfies Prisma.ProductInclude;

const productDetailInclude = {
  category: { select: { id: true, name: true } },
  variants: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { recipes: true } } },
  },
  extras: {
    orderBy: { name: 'asc' },
    include: {
      ingredients: {
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
    },
  },
  ingredientExclusions: {
    include: {
      ingredient: {
        select: { id: true, name: true, baseUnit: true, displayUnit: true },
      },
    },
  },
  comboComponents: {
    include: {
      component: {
        select: { id: true, name: true, price: true, isActive: true },
      },
      variant: { select: { id: true, name: true } },
    },
  },
  recipes: {
    orderBy: { variantId: 'asc' },
    include: {
      variant: { select: { id: true, name: true } },
      ingredients: {
        include: {
          ingredient: {
            select: { id: true, name: true, baseUnit: true, displayUnit: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  includeInactive?: boolean;
  onlyCombos?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredientQuantities: IngredientQuantitiesService,
  ) {}

  list(organizationId: string | null, filters: ProductFilters = {}) {
    const search = filters.search?.trim();

    return this.prisma.product.findMany({
      where: {
        organizationId,
        ...(filters.includeInactive ? {} : { isActive: true }),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.onlyCombos ? { isCombo: true } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { sku: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: productListInclude,
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  async findOne(organizationId: string | null, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: productDetailInclude,
    });

    if (!product) {
      throw new NotFoundException('Artículo no encontrado');
    }

    return this.withDisplayUnits(product);
  }

  /**
   * Las cantidades de recetas y extras se guardan en la unidad canónica del
   * ingrediente; la UI las recibe en su unidad visible.
   */
  private withDisplayUnits(
    product: Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>,
  ) {
    return {
      ...product,
      extras: (product.extras ?? []).map((extra) => ({
        ...extra,
        ingredients: (extra.ingredients ?? []).map((item) => ({
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
      })),
      recipes: (product.recipes ?? []).map((recipe) => ({
        ...recipe,
        ingredients: (recipe.ingredients ?? []).map((item) => ({
          ...item,
          quantity: fromCanonicalQuantity(
            item.quantity,
            item.ingredient.displayUnit,
          ),
        })),
      })),
    };
  }

  async create(organizationId: string | null, dto: CreateProductDto) {
    const name = dto.name.trim();

    if (dto.categoryId) {
      await this.assertCategory(organizationId, dto.categoryId);
    }

    const sku = normalizeSku(dto.sku);
    if (sku) {
      await this.assertSkuAvailable(organizationId, sku);
    }

    const isCombo = dto.isCombo ?? false;
    const comboComponents = dto.comboComponents ?? [];

    if (isCombo && comboComponents.length === 0) {
      throw new BadRequestException(
        'Un combo debe tener al menos un componente',
      );
    }

    if (!isCombo && comboComponents.length > 0) {
      throw new BadRequestException(
        'Solo los artículos marcados como combo pueden tener componentes',
      );
    }

    const components = isCombo
      ? await this.validateComboComponents(organizationId, null, comboComponents)
      : [];

    const exclusions = await this.validateExclusions(
      organizationId,
      dto.exclusions ?? [],
    );

    const extras = await Promise.all(
      (dto.extras ?? []).map(async (extra) => ({
        name: extra.name.trim(),
        price: toMoney(extra.price),
        isActive: extra.isActive ?? true,
        ingredients: await this.resolveExtraIngredients(
          organizationId,
          extra.ingredients ?? [],
        ),
      })),
    );

    const product = await this.prisma.product.create({
      data: {
        organizationId,
        categoryId: dto.categoryId ?? null,
        name,
        description: normalizeOptional(dto.description),
        sku,
        price: toMoney(dto.price),
        taxRate:
          dto.taxRate === undefined || dto.taxRate === null
            ? null
            : new Prisma.Decimal(dto.taxRate),
        isCombo,
        sortOrder: dto.sortOrder ?? 0,
        variants: {
          create: (dto.variants ?? []).map((variant) => ({
            name: variant.name.trim(),
            priceAdjust: toMoney(variant.priceAdjust ?? 0),
            recipeFactor: new Prisma.Decimal(variant.recipeFactor ?? 1),
            sortOrder: variant.sortOrder ?? 0,
            isActive: variant.isActive ?? true,
          })),
        },
        extras: {
          create: extras.map((extra) => ({
            name: extra.name,
            price: extra.price,
            isActive: extra.isActive,
            ingredients: {
              create: extra.ingredients.map((ingredient) => ({
                quantity: ingredient.quantity,
                ingredient: { connect: { id: ingredient.ingredientId } },
              })),
            },
          })),
        },
        ingredientExclusions: {
          create: exclusions.map((exclusion) => ({
            label: exclusion.label,
            ingredient: { connect: { id: exclusion.ingredientId } },
          })),
        },
        comboComponents: {
          create: components.map((component) => ({
            quantity: component.quantity,
            component: { connect: { id: component.componentProductId } },
            ...(component.componentVariantId
              ? { variant: { connect: { id: component.componentVariantId } } }
              : {}),
          })),
        },
      },
    });

    return this.findOne(organizationId, product.id);
  }

  async update(organizationId: string | null, id: string, dto: UpdateProductDto) {
    const product = await this.getProduct(organizationId, id);

    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.assertCategory(organizationId, dto.categoryId);
    }

    if (dto.sku !== undefined && dto.sku !== null) {
      const sku = normalizeSku(dto.sku);
      if (sku) {
        await this.assertSkuAvailable(organizationId, sku, product.id);
      }
    }

    if (dto.isCombo === false && product.isCombo) {
      await this.prisma.comboComponent.deleteMany({
        where: { comboId: product.id },
      });
    }

    if (dto.isCombo === true && !product.isCombo) {
      const usedAsComponent = await this.prisma.comboComponent.count({
        where: {
          componentProductId: product.id,
          combo: { isActive: true },
        },
      });

      if (usedAsComponent > 0) {
        throw new ConflictException(
          'El artículo es componente de un combo activo. No puede convertirse en combo',
        );
      }
    }

    await this.prisma.product.update({
      where: { id: product.id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : normalizeOptional(dto.description),
        sku: dto.sku === undefined ? undefined : normalizeSku(dto.sku),
        categoryId: dto.categoryId,
        price: dto.price === undefined ? undefined : toMoney(dto.price),
        taxRate:
          dto.taxRate === undefined
            ? undefined
            : dto.taxRate === null
              ? null
              : new Prisma.Decimal(dto.taxRate),
        isCombo: dto.isCombo,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });

    if (dto.variants !== undefined) {
      await this.syncVariants(product.id, dto.variants);
    }

    return this.findOne(organizationId, product.id);
  }

  /**
   * Sincroniza presentaciones por nombre: actualiza las existentes, crea las
   * nuevas y desactiva las que ya no vienen (nunca las borra, para conservar
   * pedidos históricos).
   */
  private async syncVariants(
    productId: string,
    variants: CreateVariantDto[],
  ) {
    const existing = await this.prisma.productVariant.findMany({
      where: { productId },
    });
    const incoming = new Set(
      variants.map((variant) => variant.name.trim().toLowerCase()),
    );

    for (const [index, variant] of variants.entries()) {
      const name = variant.name.trim();
      const match = existing.find(
        (candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase(),
      );

      if (match) {
        await this.prisma.productVariant.update({
          where: { id: match.id },
          data: {
            name,
            priceAdjust: toMoney(variant.priceAdjust ?? 0),
            recipeFactor: new Prisma.Decimal(variant.recipeFactor ?? 1),
            sortOrder: variant.sortOrder ?? index,
            isActive: variant.isActive ?? true,
          },
        });
      } else {
        await this.prisma.productVariant.create({
          data: {
            productId,
            name,
            priceAdjust: toMoney(variant.priceAdjust ?? 0),
            recipeFactor: new Prisma.Decimal(variant.recipeFactor ?? 1),
            sortOrder: variant.sortOrder ?? index,
            isActive: variant.isActive ?? true,
          },
        });
      }
    }

    for (const variant of existing) {
      if (
        variant.isActive &&
        !incoming.has(variant.name.trim().toLowerCase())
      ) {
        await this.prisma.productVariant.update({
          where: { id: variant.id },
          data: { isActive: false },
        });
      }
    }
  }

  async deactivate(organizationId: string | null, id: string) {
    const product = await this.getProduct(organizationId, id);

    const usedInCombos = await this.prisma.comboComponent.count({
      where: {
        componentProductId: product.id,
        combo: { isActive: true },
      },
    });

    if (usedInCombos > 0) {
      throw new ConflictException(
        'El artículo es componente de un combo activo. Quítalo del combo antes de desactivarlo',
      );
    }

    await this.prisma.product.update({
      where: { id: product.id },
      data: { isActive: false },
    });

    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // Variantes
  // --------------------------------------------------------------------------

  async createVariant(
    organizationId: string | null,
    productId: string,
    dto: CreateVariantDto,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const name = dto.name.trim();
    await this.assertVariantNameAvailable(product.id, name);

    const variant = await this.prisma.productVariant.create({
      data: {
        productId: product.id,
        name,
        priceAdjust: toMoney(dto.priceAdjust ?? 0),
        recipeFactor: new Prisma.Decimal(dto.recipeFactor ?? 1),
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    return this.findOne(organizationId, product.id).then((detail) => ({
      product: detail,
      variant,
    }));
  }

  async updateVariant(
    organizationId: string | null,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const variant = await this.getVariant(product.id, variantId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== variant.name) {
        await this.assertVariantNameAvailable(product.id, name, variant.id);
      }
    }

    const updated = await this.prisma.productVariant.update({
      where: { id: variant.id },
      data: {
        name: dto.name?.trim(),
        priceAdjust:
          dto.priceAdjust === undefined
            ? undefined
            : toMoney(dto.priceAdjust),
        recipeFactor:
          dto.recipeFactor === undefined
            ? undefined
            : new Prisma.Decimal(dto.recipeFactor),
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });

    return this.findOne(organizationId, product.id).then((detail) => ({
      product: detail,
      variant: updated,
    }));
  }

  async deactivateVariant(
    organizationId: string | null,
    productId: string,
    variantId: string,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const variant = await this.getVariant(product.id, variantId);

    const usedInCombos = await this.prisma.comboComponent.count({
      where: {
        componentVariantId: variant.id,
        combo: { isActive: true },
      },
    });

    if (usedInCombos > 0) {
      throw new ConflictException(
        'La variante es componente de un combo activo. Quítala del combo antes de desactivarla',
      );
    }

    await this.prisma.productVariant.update({
      where: { id: variant.id },
      data: { isActive: false },
    });

    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // Extras
  // --------------------------------------------------------------------------

  async createExtra(
    organizationId: string | null,
    productId: string,
    dto: CreateExtraDto,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const ingredients = await this.resolveExtraIngredients(
      organizationId,
      dto.ingredients ?? [],
    );

    const extra = await this.prisma.productExtra.create({
      data: {
        productId: product.id,
        name: dto.name.trim(),
        price: toMoney(dto.price),
        isActive: dto.isActive ?? true,
        ingredients: {
          create: ingredients.map((ingredient) => ({
            quantity: ingredient.quantity,
            ingredient: { connect: { id: ingredient.ingredientId } },
          })),
        },
      },
    });

    return this.findOne(organizationId, product.id).then((detail) => ({
      product: detail,
      extra,
    }));
  }

  async updateExtra(
    organizationId: string | null,
    productId: string,
    extraId: string,
    dto: UpdateExtraDto,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const extra = await this.prisma.productExtra.findFirst({
      where: { id: extraId, productId: product.id },
    });

    if (!extra) {
      throw new NotFoundException('Extra no encontrado');
    }

    const ingredients =
      dto.ingredients === undefined
        ? undefined
        : await this.resolveExtraIngredients(organizationId, dto.ingredients);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (ingredients) {
        await tx.productExtraIngredient.deleteMany({
          where: { productExtraId: extra.id },
        });
      }

      return tx.productExtra.update({
        where: { id: extra.id },
        data: {
          name: dto.name?.trim(),
          price: dto.price === undefined ? undefined : toMoney(dto.price),
          isActive: dto.isActive,
          ...(ingredients
            ? {
                ingredients: {
                  create: ingredients.map((ingredient) => ({
                    quantity: ingredient.quantity,
                    ingredient: { connect: { id: ingredient.ingredientId } },
                  })),
                },
              }
            : {}),
        },
      });
    });

    return this.findOne(organizationId, product.id).then((detail) => ({
      product: detail,
      extra: updated,
    }));
  }

  async deactivateExtra(
    organizationId: string | null,
    productId: string,
    extraId: string,
  ) {
    const product = await this.getProduct(organizationId, productId);
    const extra = await this.prisma.productExtra.findFirst({
      where: { id: extraId, productId: product.id },
    });

    if (!extra) {
      throw new NotFoundException('Extra no encontrado');
    }

    await this.prisma.productExtra.update({
      where: { id: extra.id },
      data: { isActive: false },
    });

    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // Exclusiones y combos (reemplazo completo)
  // --------------------------------------------------------------------------

  async replaceExclusions(
    organizationId: string | null,
    productId: string,
    exclusions: ExclusionInputDto[],
  ) {
    const product = await this.getProduct(organizationId, productId);
    const normalized = await this.validateExclusions(
      organizationId,
      exclusions,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.productIngredientExclusion.deleteMany({
        where: { productId: product.id },
      });

      if (normalized.length > 0) {
        await tx.productIngredientExclusion.createMany({
          data: normalized.map((exclusion) => ({
            productId: product.id,
            ingredientId: exclusion.ingredientId,
            label: exclusion.label,
          })),
        });
      }
    });

    return this.findOne(organizationId, product.id);
  }

  async replaceComboComponents(
    organizationId: string | null,
    productId: string,
    components: ComboComponentInputDto[],
  ) {
    const product = await this.getProduct(organizationId, productId);

    if (!product.isCombo) {
      throw new BadRequestException(
        'Marca el artículo como combo antes de configurar sus componentes',
      );
    }

    if (components.length === 0) {
      throw new BadRequestException(
        'El combo debe tener al menos un componente',
      );
    }

    const normalized = await this.validateComboComponents(
      organizationId,
      product.id,
      components,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.comboComponent.deleteMany({ where: { comboId: product.id } });
      await tx.comboComponent.createMany({
        data: normalized.map((component) => ({
          comboId: product.id,
          componentProductId: component.componentProductId,
          componentVariantId: component.componentVariantId,
          quantity: component.quantity,
        })),
      });
    });

    return this.findOne(organizationId, product.id);
  }

  // --------------------------------------------------------------------------
  // Validaciones
  // --------------------------------------------------------------------------

  private async getProduct(organizationId: string | null, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
    });

    if (!product) {
      throw new NotFoundException('Artículo no encontrado');
    }

    return product;
  }

  private async getVariant(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });

    if (!variant) {
      throw new NotFoundException('Variante no encontrada');
    }

    return variant;
  }

  private async assertCategory(organizationId: string | null, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    if (!category.isActive) {
      throw new BadRequestException('La categoría está desactivada');
    }

    return category;
  }

  private async assertSkuAvailable(
    organizationId: string | null,
    sku: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.product.findFirst({
      where: {
        organizationId,
        sku: { equals: sku, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Ya existe un artículo con ese SKU');
    }
  }

  private async assertVariantNameAvailable(
    productId: string,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.productVariant.findFirst({
      where: {
        productId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe una variante con ese nombre en el artículo',
      );
    }
  }

  private async resolveExtraIngredients(
    organizationId: string | null,
    input: ExtraIngredientInputDto[],
  ) {
    return this.ingredientQuantities.resolve(organizationId, input);
  }

  private async validateExclusions(
    organizationId: string | null,
    input: ExclusionInputDto[],
  ) {
    const seen = new Set<string>();
    const result: Array<{ ingredientId: string; label?: string }> = [];

    for (const exclusion of input) {
      if (seen.has(exclusion.ingredientId)) {
        throw new BadRequestException(
          'Un ingrediente no puede repetirse en las exclusiones',
        );
      }
      seen.add(exclusion.ingredientId);

      const ingredient = await this.prisma.ingredient.findFirst({
        where: { id: exclusion.ingredientId, organizationId },
        select: { id: true },
      });

      if (!ingredient) {
        throw new NotFoundException('Ingrediente no encontrado');
      }

      result.push({
        ingredientId: ingredient.id,
        label: normalizeOptional(exclusion.label) ?? undefined,
      });
    }

    return result;
  }

  private async validateComboComponents(
    organizationId: string | null,
    comboId: string | null,
    input: ComboComponentInputDto[],
  ) {
    const seen = new Set<string>();
    const result: Array<{
      componentProductId: string;
      componentVariantId: string | null;
      quantity: number;
    }> = [];

    for (const item of input) {
      if (comboId && item.productId === comboId) {
        throw new BadRequestException(
          'Un combo no puede contenerse a sí mismo',
        );
      }

      const key = `${item.productId}:${item.variantId ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'Los componentes del combo no pueden repetirse',
        );
      }
      seen.add(key);

      const component = await this.prisma.product.findFirst({
        where: { id: item.productId, organizationId },
      });

      if (!component) {
        throw new NotFoundException('Artículo componente no encontrado');
      }

      if (component.isCombo) {
        throw new BadRequestException(
          'No se permiten combos dentro de otro combo',
        );
      }

      if (!component.isActive) {
        throw new BadRequestException(
          `El artículo "${component.name}" está desactivado`,
        );
      }

      if (item.variantId) {
        const variant = await this.prisma.productVariant.findFirst({
          where: { id: item.variantId, productId: component.id },
        });

        if (!variant) {
          throw new NotFoundException(
            'La variante no pertenece al artículo componente',
          );
        }
      }

      result.push({
        componentProductId: component.id,
        componentVariantId: item.variantId ?? null,
        quantity: item.quantity ?? 1,
      });
    }

    return result;
  }
}

function normalizeOptional(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSku(value: string | undefined | null) {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

