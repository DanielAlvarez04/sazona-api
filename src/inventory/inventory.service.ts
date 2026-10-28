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
  branch: { select: { id: true, name: true } },
} as const;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantities: QuantityConverter,
  ) {}

  async listIngredients(
    organizationId: string | null,
    filters: IngredientFilters = {},
    branchId: string | null = null,
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
        _count: { select: { recipeIngredients: true, variants: true } },
        category: { select: { id: true, name: true, isCore: true } },
        location: { select: { id: true, name: true, isCore: true } },
        variants: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            name: true,
            sku: true,
            sequence: true,
            unitCost: true,
            minStock: true,
            maxStock: true,
            isActive: true,
          },
        },
        ...(branchId
          ? { branchStocks: { where: { branchId }, select: { quantity: true } } }
          : {}),
      },
      orderBy: { name: 'asc' },
    });

    return ingredients
      .map((ingredient) => {
        // Con sucursal activa se muestra su existencia; el total de la
        // organización se conserva en `organizationStock`. Si la sucursal aún
        // no tiene fila de stock, su existencia es 0 (no el total de la org).
        const branchStock = branchId
          ? (ingredient as { branchStocks?: Array<{ quantity: Prisma.Decimal }> })
              .branchStocks?.[0]?.quantity
          : undefined;
        const stock = branchId
          ? (branchStock ?? new Prisma.Decimal(0))
          : ingredient.currentStock;

        return {
          ...ingredient,
          currentStock: stock,
          organizationStock: ingredient.currentStock,
          branchId,
          isLowStock: stock.lte(ingredient.minStock),
          deficit: stock.lt(ingredient.minStock)
            ? ingredient.minStock.minus(stock)
            : new Prisma.Decimal(0),
        };
      })
      .filter((ingredient) => !filters.lowStockOnly || ingredient.isLowStock);
  }

  async createIngredient(
    organizationId: string | null,
    userId: string,
    dto: CreateIngredientDto,
    branchId: string | null = null,
  ) {
    const name = dto.name.trim();
    await this.assertNameAvailable(organizationId, name);

    // La categoría es obligatoria y define el prefijo del SKU.
    const category = await this.resolveCategory(organizationId, dto.categoryId);
    const sku = await this.generateSku(organizationId, category.name);

    const initialStock = toQuantity(dto.currentStock ?? 0);

    const ingredient = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ingredient.create({
        data: {
          organizationId,
          name,
          sku,
          baseUnit: dto.baseUnit ?? UnitCode.UNIT,
          minStock: toQuantity(dto.minStock ?? 0),
          maxStock: dto.maxStock !== undefined ? toQuantity(dto.maxStock) : null,
          unitCost: dto.unitCost !== undefined ? toQuantity(dto.unitCost) : null,
          categoryId: category.id,
          locationId: dto.locationId || null,
        },
      });

      if (initialStock.gt(0)) {
        if (!organizationId) {
          throw new BadRequestException(
            'Organization required for inventory movement',
          );
        }

        await tx.ingredient.update({
          where: { id: created.id },
          data: { currentStock: initialStock },
        });

        if (branchId) {
          await tx.branchStock.create({
            data: {
              branchId,
              ingredientId: created.id,
              quantity: initialStock,
            },
          });
        }

        await tx.inventoryMovement.create({
          data: {
            organizationId,
            branchId,
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
    organizationId: string | null,
    userId: string,
    dtos: CreateIngredientDto[],
    branchId: string | null = null,
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
      created.push(
        await this.createIngredient(organizationId, userId, dto, branchId),
      );
    }

    return created;
  }

  /**
   * Importa ingredientes desde CSV.
   *
   * Formato esperado (cabecera opcional):
   * nombre,unidad,categoria,ubicacion,costoUnitario,stockMaximo,stockInicial,stockMinimo
   *
   * - baseUnit: código de unidad (G, KG, ML, L, UNIT, etc.)
   * - currentStock/minStock/maxStock/unitCost: números (0 por defecto)
   * - categoria: obligatoria (nombre exacto); el SKU se genera automáticamente
   * - ubicacion: nombre de la ubicación (opcional)
   * - Las unidades deben ser códigos válidos del enum UnitCode
   */
  async importIngredientsFromCsv(
    organizationId: string | null,
    userId: string,
    csvText: string,
    branchId: string | null = null,
  ) {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new BadRequestException('El CSV está vacío');
    }

    // Detectar si la primera línea es cabecera
    const hasHeader =
      /nombre|name|unidad|baseunit|stock|min|category|categoria|location|ubicacion|cost|costo|variante|variant/i.test(
        lines[0],
      );
    const startIndex = hasHeader ? 1 : 0;

    // Cargar mapas de categorías y ubicaciones
    const categories = await this.prisma.ingredientCategory.findMany({
      where: { isActive: true,
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
      select: { id: true, name: true },
    });
    const categoryMap = Object.fromEntries(
      categories.map((c) => [c.name.toLowerCase(), c.id])
    );

    const locations = await this.prisma.ingredientLocation.findMany({
      where: { isActive: true,
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
      select: { id: true, name: true },
    });
    const locationMap = Object.fromEntries(
      locations.map((l) => [l.name.toLowerCase(), l.id])
    );

    const dtos: ImportIngredientRowDto[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      // Parse CSV respetando campos entre comillas (las categorías pueden
      // contener comas, p. ej. "Aceites, salsas y condimentos").
      const cols = parseCsvLine(line);

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
      const categoryName = cols[2]?.toLowerCase().trim();
      const locationName = cols[3]?.toLowerCase().trim();
      const unitCost = cols[4] ? Number(cols[4].replace(',', '.')) : undefined;
      const maxStock = cols[5] ? Number(cols[5].replace(',', '.')) : undefined;
      const currentStock = cols[6] ? Number(cols[6].replace(',', '.')) : 0;
      const minStock = cols[7] ? Number(cols[7].replace(',', '.')) : 0;

      if (baseUnit && !Object.values(UnitCode).includes(baseUnit)) {
        throw new BadRequestException(
          `Línea ${i + 1}: unidad "${cols[1]}" no válida. Unidades válidas: ${Object.values(UnitCode).join(', ')}`,
        );
      }

      if (!categoryName) {
        throw new BadRequestException(
          `Línea ${i + 1}: la categoría es obligatoria`,
        );
      }

      const categoryId = categoryMap[categoryName];
      if (!categoryId) {
        throw new BadRequestException(
          `Línea ${i + 1}: categoría "${cols[2]}" no encontrada`,
        );
      }

      const locationId = locationName ? locationMap[locationName] : undefined;
      if (locationName && !locationId) {
        throw new BadRequestException(
          `Línea ${i + 1}: ubicación "${cols[3]}" no encontrada`,
        );
      }

      if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) {
        throw new BadRequestException(
          `Línea ${i + 1}: costo unitario inválido`,
        );
      }
      if (maxStock !== undefined && (!Number.isFinite(maxStock) || maxStock < 0)) {
        throw new BadRequestException(
          `Línea ${i + 1}: stock máximo inválido`,
        );
      }
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
        categoryId,
        locationId,
        unitCost,
        maxStock,
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
      created.push(
        await this.createIngredient(organizationId, userId, dto, branchId),
      );
    }

    return created;
  }

  async updateIngredient(
    organizationId: string | null,
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

    // El SKU no se edita: se regenera con el prefijo de la nueva categoría.
    let nextCategoryId: string | undefined;
    let nextSku: string | undefined;

    if (dto.categoryId !== undefined) {
      const category = await this.resolveCategory(organizationId, dto.categoryId);
      nextCategoryId = category.id;

      if (category.id !== ingredient.categoryId) {
        nextSku = await this.generateSku(organizationId, category.name);
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.ingredient.update({
        where: { id: ingredient.id },
        data: {
          name: dto.name?.trim(),
          baseUnit: dto.baseUnit,
          minStock:
            dto.minStock === undefined ? undefined : toQuantity(dto.minStock),
          maxStock:
            dto.maxStock === undefined ? undefined : toQuantity(dto.maxStock),
          unitCost:
            dto.unitCost === undefined ? undefined : toQuantity(dto.unitCost),
          ...(nextCategoryId ? { categoryId: nextCategoryId } : {}),
          ...(nextSku ? { sku: nextSku } : {}),
          locationId: dto.locationId || null,
          isActive: dto.isActive,
        },
      });

      return next;
    });

    return this.withFlags(updated);
  }

  async deactivateIngredient(organizationId: string | null, id: string) {
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
    organizationId: string | null,
    userId: string,
    dto: CreateAdjustmentDto,
    branchId: string | null = null,
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
      if (!organizationId) {
        throw new BadRequestException(
          'Organization required for inventory movement',
        );
      }

      return await this.prisma.$transaction(async (tx) => {
        const stockAfter = branchId
          ? await this.applyBranchDelta(
              tx,
              organizationId,
              ingredient.id,
              branchId,
              quantity,
            )
          : await this.applyOrganizationDelta(
              tx,
              organizationId,
              ingredient.id,
              quantity,
            );

        return tx.inventoryMovement.create({
          data: {
            organizationId,
            branchId,
            ingredientId: ingredient.id,
            userId,
            type: InventoryMovementType.ADJUSTMENT,
            quantity,
            stockAfter,
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

  /**
   * Aplica un delta al stock de una sucursal.
   *
   * El total del ingrediente (`Ingredient.currentStock`) se mueve en paralelo
   * para que los reportes consolidados sigan siendo correctos.
   */
  private async applyBranchDelta(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ingredientId: string,
    branchId: string,
    delta: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const amount = delta.toString();

    // La fila puede no existir todavía (primer movimiento en esa sucursal).
    await tx.$executeRaw`
      INSERT INTO "BranchStock" ("id", "branchId", "ingredientId", "quantity", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${branchId}, ${ingredientId}, 0, NOW(), NOW())
      ON CONFLICT ("branchId", "ingredientId") DO NOTHING
    `;

    const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
      UPDATE "BranchStock"
      SET "quantity" = "quantity" + CAST(${amount} AS numeric),
          "updatedAt" = NOW()
      WHERE "branchId" = ${branchId}
        AND "ingredientId" = ${ingredientId}
        AND "quantity" + CAST(${amount} AS numeric) >= 0
      RETURNING "quantity"
    `;

    if (rows.length === 0) {
      throw new BadRequestException('El ajuste dejaría el stock en negativo');
    }

    await tx.$executeRaw`
      UPDATE "Ingredient"
      SET "currentStock" = "currentStock" + CAST(${amount} AS numeric),
          "updatedAt" = NOW()
      WHERE "id" = ${ingredientId}
        AND "organizationId" = ${organizationId}
    `;

    return new Prisma.Decimal(rows[0].quantity);
  }

  /** Aplica un delta al stock consolidado (sin sucursal activa). */
  private async applyOrganizationDelta(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ingredientId: string,
    delta: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const amount = delta.toString();

    const rows = await tx.$queryRaw<Array<{ currentStock: Prisma.Decimal }>>`
      UPDATE "Ingredient"
      SET "currentStock" = "currentStock" + CAST(${amount} AS numeric),
          "updatedAt" = NOW()
      WHERE "id" = ${ingredientId}
        AND "organizationId" = ${organizationId}
        AND "currentStock" + CAST(${amount} AS numeric) >= 0
      RETURNING "currentStock"
    `;

    if (rows.length === 0) {
      throw new BadRequestException('El ajuste dejaría el stock en negativo');
    }

    return new Prisma.Decimal(rows[0].currentStock);
  }

  listMovements(
    organizationId: string | null,
    filters: MovementFilters = {},
    branchId: string | null = null,
  ) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    return this.prisma.inventoryMovement.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(filters.ingredientId ? { ingredientId: filters.ingredientId } : {}),
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

  async listAlerts(
    organizationId: string | null,
    branchId: string | null = null,
  ) {
    // Return low stock ingredients sorted by deficit descending
    const low = await this.listIngredients(
      organizationId,
      { lowStockOnly: true },
      branchId,
    );
    // Sort descending by deficit (largest deficit first)
    return low.sort((a, b) => {
      if (a.deficit.gt(b.deficit)) return -1;
      if (a.deficit.lt(b.deficit)) return 1;
      return 0;
    });
  }



  async ensureCoreDefaults() {
    // Core categories that are shared across all organizations (organizationId = null)
    const coreCategories = [
      { name: 'Frutas y verduras', description: 'Productos frescos de origen vegetal', sortOrder: 1 },
      { name: 'Abarrotes y secos', description: 'Alimentos no perecederos, granos, harinas, conservas', sortOrder: 2 },
      { name: 'Lácteos y huevo', description: 'Leche, quesos, yogures, huevos y derivados', sortOrder: 3 },
      { name: 'Carnes y proteínas', description: 'Carnes rojas, aves, pescados, mariscos, legumbres', sortOrder: 4 },
      { name: 'Café, té y chocolate', description: 'Café en grano/molido, tés, cacao, chocolate', sortOrder: 5 },
      { name: 'Bebidas e ingredientes para bebidas', description: 'Jugos, refrescos, alcoholes, syrups, bases', sortOrder: 6 },
      { name: 'Aceites, salsas y condimentos', description: 'Aceites, vinagres, salsas, especias, adobos', sortOrder: 7 },
      { name: 'Panadería y tortillas', description: 'Pan, tortillas, masas, productos de panadería', sortOrder: 8 },
      { name: 'Desechables y empaques', description: 'Vasos, cubiertos, servilletas, bolsas, film', sortOrder: 9 },
      { name: 'Limpieza e higiene', description: 'Detergentes, desinfectantes, jabones, papel', sortOrder: 10 },
      { name: 'Material de cocina', description: 'Utensilios, ollas, sartenes, cuchillos, equipos', sortOrder: 11 },
      { name: 'Otros insumos', description: 'Todo lo que no encaje en las categorías anteriores', sortOrder: 12 },
    ];

    // Core locations shared globally (organizationId = null)
    const coreLocations = [
      { name: 'Almacén seco', description: 'Zona de almacenamiento a temperatura ambiente', sortOrder: 1 },
      { name: 'Refrigerador', description: 'Cámara fría / refrigerador principal (2-8°C)', sortOrder: 2 },
      { name: 'Congelador', description: 'Congelador / freezer (-18°C o menos)', sortOrder: 3 },
      { name: 'Cocina / Área de preparación', description: 'Zona de trabajo y mise en place', sortOrder: 4 },
      { name: 'Barra de bebidas', description: 'Área de servicio de bebidas y café', sortOrder: 5 },
      { name: 'Almacén de desechables', description: 'Stock de vasos, cubiertos, servilletas, empaques', sortOrder: 6 },
      { name: 'Área de limpieza', description: 'Productos de limpieza e higiene', sortOrder: 7 },
      { name: 'Bodega auxiliar', description: 'Almacén secundario / overflow', sortOrder: 8 },
    ];

    // Insert core categories
    for (const cat of coreCategories) {
      try {
        await this.prisma.ingredientCategory.create({
          data: { organizationId: null as any, ...cat, isCore: true, isActive: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // duplicate, ignore
        } else {
          throw e;
        }
      }
    }

    // Insert core locations
    for (const loc of coreLocations) {
      try {
        await this.prisma.ingredientLocation.create({
          data: { organizationId: null as any, ...loc, isCore: true, isActive: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // duplicate, ignore
        } else {
          throw e;
        }
      }
    }
  }

  async listIngredientCategories(organizationId: string | null) {
    return this.prisma.ingredientCategory.findMany({
      where: { isActive: true,
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        isCore: true,
        isActive: true,
        sortOrder: true,
      },
    });
  }

  async listIngredientLocations(organizationId: string | null) {
    return this.prisma.ingredientLocation.findMany({
      where: { isActive: true,
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        isCore: true,
        isActive: true,
        sortOrder: true,
      },
    });
  }

  // --------------------------------------------------------------------------
  // Equivalencias entre dimensiones
  // --------------------------------------------------------------------------

  async listEquivalences(organizationId: string | null, ingredientId: string) {
    const ingredient = await this.getIngredient(organizationId, ingredientId);

    return this.prisma.ingredientEquivalence.findMany({
      where: { ingredientId: ingredient.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createEquivalence(
    organizationId: string | null,
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
    organizationId: string | null,
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

  private async getIngredient(organizationId: string | null, id: string) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingrediente no encontrado');
    }

    return ingredient;
  }

  private async getVariant(organizationId: string | null, id: string) {
    const variant = await this.prisma.ingredientVariant.findFirst({
      where: {
        id,
        ...(organizationId ? { ingredient: { organizationId } } : {}),
      },
    });

    if (!variant) {
      throw new NotFoundException('Variante no encontrada');
    }

    return variant;
  }

  /**
   * Valida que la categoría exista (core o de la organización) y esté activa.
   * Es obligatoria porque de su nombre se deriva el SKU.
   */
  private async resolveCategory(
    organizationId: string | null,
    categoryId: string,
  ) {
    const category = await this.prisma.ingredientCategory.findFirst({
      where: {
        id: categoryId,
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: { id: true, name: true },
    });

    if (!category) {
      throw new BadRequestException(
        'Selecciona una categoría válida para el ingrediente',
      );
    }

    return category;
  }

  /**
   * Prefijo de 3 letras para el SKU a partir del nombre de la categoría.
   *
   * Usa la inicial de las tres primeras palabras significativas (omite
   * artículos y preposiciones). Si hay menos palabras, completa con las
   * siguientes letras de la última.
   *
   * Ej.: "Frutas y verduras" → FVE · "Otros insumos" → OIN
   */
  private categoryPrefix(name: string): string {
    const stopWords = new Set([
      'y',
      'e',
      'o',
      'de',
      'del',
      'para',
      'con',
      'la',
      'el',
      'los',
      'las',
      'en',
      'al',
    ]);

    const plain = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim();

    const words = plain
      .split(/\s+/)
      .filter((word) => word.length > 0 && !stopWords.has(word.toLowerCase()));

    let prefix = words
      .slice(0, 3)
      .map((word) => word[0])
      .join('')
      .toUpperCase();

    // Menos de tres palabras: se toman más letras de la última.
    if (prefix.length < 3) {
      const lastWord = (words[words.length - 1] ?? '').toUpperCase();
      let index = 1;

      while (prefix.length < 3 && index < lastWord.length) {
        prefix += lastWord[index];
        index += 1;
      }
    }

    // Último recurso (nombres muy cortos o símbolos).
    if (prefix.length < 3) {
      for (const char of plain.replace(/\s/g, '').toUpperCase()) {
        if (prefix.length >= 3) break;
        prefix += char;
      }
    }

    return prefix.slice(0, 3).padEnd(3, 'X');
  }

  /**
   * Genera el siguiente SKU de la categoría: `PREFIX###` desde 100.
   *
   * El consecutivo es por organización y prefijo; se calcula a partir del
   * mayor número ya usado para no reutilizar códigos aunque se borren filas.
   */
  private async generateSku(
    organizationId: string | null,
    categoryName: string,
  ): Promise<string> {
    const prefix = this.categoryPrefix(categoryName);
    const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');

    const existing = await this.prisma.ingredient.findMany({
      where: {
        organizationId,
        sku: { startsWith: prefix, mode: 'insensitive' },
      },
      select: { sku: true },
    });

    let max = 99;

    for (const row of existing) {
      const match = row.sku?.match(pattern);
      if (match) {
        max = Math.max(max, Number(match[1]));
      }
    }

    let next = max + 1;
    let sku = `${prefix}${next}`;

    // Salvaguarda ante carreras o SKUs manuales heredados.
    while (await this.skuExists(organizationId, sku)) {
      next += 1;
      sku = `${prefix}${next}`;
    }

    return sku;
  }

  private async skuExists(organizationId: string | null, sku: string) {
    const existing = await this.prisma.ingredient.findFirst({
      where: { organizationId, sku: { equals: sku, mode: 'insensitive' } },
      select: { id: true },
    });

    return Boolean(existing);
  }

  private async assertNameAvailable(
    organizationId: string | null,
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

/**
 * Divide una línea CSV respetando comillas dobles.
 *
 * Necesario porque nombres de categoría como "Aceites, salsas y condimentos"
 * contienen comas que no deben separar columnas.
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}
