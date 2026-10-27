import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  UnitCode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuantityConverter } from '../common/quantity-converter.service';
import { toQuantity, unitDefinition } from '../common/units';
import {
  CreateAdjustmentDto,
  CreateEquivalenceDto,
  CreateIngredientDto,
  ImportIngredientRowDto,
  UpdateIngredientDto,
} from './dto/inventory.dto';

export interface IngredientFilters {
  search?: string;
  includeInactive?: boolean;
  lowStockOnly?: boolean;
}

export interface MovementFilters {
  ingredientId?: string;
  type?: InventoryMovementType;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

const movementInclude = {
  ingredient: { select: { id: true, name: true, baseUnit: true } },
  user: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantities: QuantityConverter,
  ) {}

  async listIngredients(
    organizationId: string,
    filters: IngredientFilters = {},
  ) {
    const search = filters.search?.trim();

    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        organizationId,
        ...(filters.includeInactive ? {} : { isActive: true }),
        ...(search
          ? { name: { contains: search, mode: 'insensitive' as const } }
          : {}),
      },
      include: {
        _count: { select: { recipeIngredients: true } },
      },
      orderBy: { name: 'asc' },
    });

    return ingredients
      .map((ingredient) => ({
        ...ingredient,
        isLowStock: ingredient.currentStock.lte(ingredient.minStock),
        deficit: ingredient.currentStock.lt(ingredient.minStock)
          ? ingredient.minStock.minus(ingredient.currentStock)
          : new Prisma.Decimal(0),
      }))
      .filter((ingredient) => !filters.lowStockOnly || ingredient.isLowStock);
  }

  async createIngredient(
    organizationId: string,
    userId: string,
    dto: CreateIngredientDto,
  ) {
    const name = dto.name.trim();
    await this.assertNameAvailable(organizationId, name);

    const initialStock = toQuantity(dto.currentStock ?? 0);

    const ingredient = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ingredient.create({
        data: {
          organizationId,
          name,
          baseUnit: dto.baseUnit ?? UnitCode.UNIT,
          minStock: toQuantity(dto.minStock ?? 0),
        },
      });

      if (initialStock.gt(0)) {
        await tx.ingredient.update({
          where: { id: created.id },
          data: { currentStock: initialStock },
        });

        await tx.inventoryMovement.create({
          data: {
            organizationId,
            ingredientId: created.id,
            userId,
            type: InventoryMovementType.ADJUSTMENT,
            quantity: initialStock,
            stockAfter: initialStock,
            reason: 'Stock inicial',
            referenceType: 'INGREDIENT_CREATED',
          },
        });
      }

      return tx.ingredient.findUniqueOrThrow({ where: { id: created.id } });
    });

    return this.withFlags(ingredient);
  }

  /**
   * Alta masiva de ingredientes desde una sola pantalla.
   *
   * Cada ingrediente conserva su propio movimiento de stock inicial. Se valida
   * la lista completa antes de crear nada para no dejar altas a medias.
   */
  async createIngredients(
    organizationId: string,
    userId: string,
    dtos: CreateIngredientDto[],
  ) {
    const seen = new Set<string>();

    for (const dto of dtos) {
      const name = dto.name.trim();
      const key = name.toLowerCase();

      if (seen.has(key)) {
        throw new BadRequestException(
          `"${name}" está repetido en la lista`,
        );
      }

      seen.add(key);
    }

    for (const dto of dtos) {
      await this.assertNameAvailable(organizationId, dto.name.trim());
    }

    const created = [];

    for (const dto of dtos) {
      created.push(await this.createIngredient(organizationId, userId, dto));
    }

    return created;
  }

  /**
   * Importa ingredientes desde CSV.
   *
   * Formato esperado (cabecera opcional):
   * name,baseUnit,currentStock,minStock
   *
   * - baseUnit: código de unidad (G, KG, ML, L, UNIT, etc.)
   * - currentStock/minStock: números (0 por defecto)
   * - Las unidades deben ser códigos válidos del enum UnitCode
   */
  async importIngredientsFromCsv(
    organizationId: string,
    userId: string,
    csvText: string,
  ) {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new BadRequestException('El CSV está vacío');
    }

    // Detectar si la primera línea es cabecera
    const hasHeader = /name|baseunit|stock|min/i.test(lines[0]);
    const startIndex = hasHeader ? 1 : 0;

    const dtos: ImportIngredientRowDto[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      // Parse CSV simple (sin comillas anidadas)
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));

      if (cols.length < 1 || cols[0] === '') {
        continue; // Saltar líneas vacías
      }

      const name = cols[0];
      if (!name || name.length < 2) {
        throw new BadRequestException(
          `Línea ${i + 1}: nombre de ingrediente inválido`,
        );
      }

      const baseUnit = (cols[1]?.toUpperCase() ?? 'UNIT') as UnitCode;
      if (baseUnit && !Object.values(UnitCode).includes(baseUnit)) {
        throw new BadRequestException(
          `Línea ${i + 1}: unidad "${cols[1]}" no válida. Unidades válidas: ${Object.values(UnitCode).join(', ')}`,
        );
      }

      const currentStock = cols[2] ? Number(cols[2].replace(',', '.')) : 0;
      const minStock = cols[3] ? Number(cols[3].replace(',', '.')) : 0;

      if (!Number.isFinite(currentStock) || currentStock < 0) {
        throw new BadRequestException(
          `Línea ${i + 1}: stock inicial inválido`,
        );
      }
      if (!Number.isFinite(minStock) || minStock < 0) {
        throw new BadRequestException(
          `Línea ${i + 1}: stock mínimo inválido`,
        );
      }

      dtos.push({
        name: name.trim(),
        baseUnit,
        currentStock,
        minStock,
      });
    }

    if (dtos.length === 0) {
      throw new BadRequestException('No se encontraron ingredientes válidos en el CSV');
    }

    // Validar duplicados en la lista
    const seen = new Set<string>();
    for (const dto of dtos) {
      const key = dto.name.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(
          `"${dto.name}" está repetido en el CSV`,
        );
      }
      seen.add(key);
    }

    // Validar que no existan en la BD
    for (const dto of dtos) {
      await this.assertNameAvailable(organizationId, dto.name);
    }

    // Crear todos en una transacción
    const created = [];

    for (const dto of dtos) {
      created.push(await this.createIngredient(organizationId, userId, dto));
    }

    return created;
  }

  async updateIngredient(
    organizationId: string,
    id: string,
    dto: UpdateIngredientDto,
  ) {
    const ingredient = await this.getIngredient(organizationId, id);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.toLowerCase() !== ingredient.name.toLowerCase()) {
        await this.assertNameAvailable(organizationId, name, ingredient.id);
      }
    }

    if (dto.baseUnit && dto.baseUnit !== ingredient.baseUnit) {
      const [inRecipes, movements] = await Promise.all([
        this.prisma.recipeIngredient.count({
          where: { ingredientId: ingredient.id },
        }),
        this.prisma.inventoryMovement.count({
          where: { ingredientId: ingredient.id },
        }),
      ]);

      if (inRecipes > 0 || movements > 0) {
        throw new ConflictException(
          'No se puede cambiar la unidad base de un ingrediente con recetas o movimientos. Crea un ingrediente nuevo y ajusta el stock',
        );
      }
    }

    const updated = await this.prisma.ingredient.update({
      where: { id: ingredient.id },
      data: {
        name: dto.name?.trim(),
        baseUnit: dto.baseUnit,
        minStock:
          dto.minStock === undefined ? undefined : toQuantity(dto.minStock),
        isActive: dto.isActive,
      },
    });

    return this.withFlags(updated);
  }

  async deactivateIngredient(organizationId: string, id: string) {
    const ingredient = await this.getIngredient(organizationId, id);

    const inActiveRecipes = await this.prisma.recipeIngredient.count({
      where: { ingredientId: ingredient.id, recipe: { isActive: true } },
    });

    if (inActiveRecipes > 0) {
      throw new ConflictException(
        'El ingrediente forma parte de recetas activas. Quítalo de las recetas antes de desactivarlo',
      );
    }

    await this.prisma.ingredient.update({
      where: { id: ingredient.id },
      data: { isActive: false },
    });

    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // Movimientos
  // --------------------------------------------------------------------------

  async adjust(
    organizationId: string,
    userId: string,
    dto: CreateAdjustmentDto,
  ) {
    if (dto.dedupeKey) {
      const existing = await this.prisma.inventoryMovement.findUnique({
        where: { dedupeKey: dto.dedupeKey },
        include: movementInclude,
      });

      if (existing) {
        return { ...existing, duplicated: true };
      }
    }

    const ingredient = await this.getIngredient(organizationId, dto.ingredientId);

    if (!ingredient.isActive) {
      throw new BadRequestException('El ingrediente está desactivado');
    }

    const rawQuantity = new Prisma.Decimal(dto.quantity);

    if (rawQuantity.isZero()) {
      throw new BadRequestException('La cantidad debe ser distinta de cero');
    }

    const quantity = await this.quantities.toBaseUnit(
      ingredient,
      rawQuantity,
      dto.unit,
    );

    if (quantity.isZero()) {
      throw new BadRequestException(
        'La cantidad es demasiado pequeña para la unidad del ingrediente',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ currentStock: Prisma.Decimal }>>`
          UPDATE "Ingredient"
          SET "currentStock" = "currentStock" + CAST(${quantity.toString()} AS numeric),
              "updatedAt" = NOW()
          WHERE "id" = ${ingredient.id}
            AND "organizationId" = ${organizationId}
            AND "currentStock" + CAST(${quantity.toString()} AS numeric) >= 0
          RETURNING "currentStock"
        `;

        if (rows.length === 0) {
          throw new BadRequestException(
            'El ajuste dejaría el stock en negativo',
          );
        }

        return tx.inventoryMovement.create({
          data: {
            organizationId,
            ingredientId: ingredient.id,
            userId,
            type: InventoryMovementType.ADJUSTMENT,
            quantity,
            stockAfter: new Prisma.Decimal(rows[0].currentStock),
            reason: dto.reason.trim(),
            referenceId: dto.referenceId?.trim() || null,
            referenceType: dto.referenceType?.trim() || 'MANUAL_ADJUSTMENT',
            dedupeKey: dto.dedupeKey?.trim() || null,
          },
          include: movementInclude,
        });
      });
    } catch (error) {
      if (
        dto.dedupeKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.inventoryMovement.findUniqueOrThrow({
          where: { dedupeKey: dto.dedupeKey },
          include: movementInclude,
        });

        return { ...existing, duplicated: true };
      }

      throw error;
    }
  }

  listMovements(organizationId: string, filters: MovementFilters = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    return this.prisma.inventoryMovement.findMany({
      where: {
        organizationId,
        ...(filters.ingredientId
          ? { ingredientId: filters.ingredientId }
          : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      include: movementInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async listAlerts(organizationId: string) {
    const ingredients = await this.prisma.ingredient.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
    });

    return ingredients
      .filter((ingredient) => ingredient.currentStock.lte(ingredient.minStock))
      .map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        baseUnit: ingredient.baseUnit,
        currentStock: ingredient.currentStock,
        minStock: ingredient.minStock,
        deficit: ingredient.minStock.minus(ingredient.currentStock),
      }))
      .sort((a, b) => b.deficit.comparedTo(a.deficit));
  }

  // --------------------------------------------------------------------------
  // Equivalencias entre dimensiones
  // --------------------------------------------------------------------------

  async listEquivalences(organizationId: string, ingredientId: string) {
    const ingredient = await this.getIngredient(organizationId, ingredientId);

    return this.prisma.ingredientEquivalence.findMany({
      where: { ingredientId: ingredient.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createEquivalence(
    organizationId: string,
    ingredientId: string,
    dto: CreateEquivalenceDto,
  ) {
    const ingredient = await this.getIngredient(organizationId, ingredientId);

    if (dto.fromUnit === dto.toUnit) {
      throw new BadRequestException('Las unidades deben ser distintas');
    }

    const source = unitDefinition(dto.fromUnit);
    const target = unitDefinition(dto.toUnit);

    if (source.dimension === target.dimension) {
      throw new BadRequestException(
        `La conversión ${source.label} → ${target.label} ya es fija y no requiere equivalencia`,
      );
    }

    try {
      return await this.prisma.ingredientEquivalence.create({
        data: {
          ingredientId: ingredient.id,
          fromUnit: dto.fromUnit,
          toUnit: dto.toUnit,
          factor: new Prisma.Decimal(dto.factor),
          note: dto.note?.trim() || null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe una equivalencia para ese par de unidades',
        );
      }
      throw error;
    }
  }

  async deleteEquivalence(
    organizationId: string,
    ingredientId: string,
    equivalenceId: string,
  ) {
    const ingredient = await this.getIngredient(organizationId, ingredientId);

    const { count } = await this.prisma.ingredientEquivalence.deleteMany({
      where: { id: equivalenceId, ingredientId: ingredient.id },
    });

    if (count === 0) {
      throw new NotFoundException('Equivalencia no encontrada');
    }

    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async getIngredient(organizationId: string, id: string) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, organizationId },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingrediente no encontrado');
    }

    return ingredient;
  }

  private async assertNameAvailable(
    organizationId: string,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.ingredient.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Ya existe un ingrediente con ese nombre');
    }
  }

  private withFlags<T extends { currentStock: Prisma.Decimal; minStock: Prisma.Decimal }>(
    ingredient: T,
  ) {
    return {
      ...ingredient,
      isLowStock: ingredient.currentStock.lte(ingredient.minStock),
      deficit: ingredient.currentStock.lt(ingredient.minStock)
        ? ingredient.minStock.minus(ingredient.currentStock)
        : new Prisma.Decimal(0),
    };
  }
}
