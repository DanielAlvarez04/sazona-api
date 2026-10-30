import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  OrderRoundStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  UnitCode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelOrderDto,
  CreateOrderDto,
  RoundItemDto,
  SendRoundDto,
  TransitionRoundDto,
} from './dto/orders.dto';
import { OrdersEventsService } from './orders.events';

/** Estados a los que puede pasar cada estado de ronda (plan.md §6.6). */
const ALLOWED_TRANSITIONS: Record<OrderRoundStatus, OrderRoundStatus[]> = {
  [OrderRoundStatus.PENDING]: [
    OrderRoundStatus.PREPARING,
    OrderRoundStatus.CANCELLED,
  ],
  [OrderRoundStatus.PREPARING]: [
    OrderRoundStatus.READY,
    OrderRoundStatus.CANCELLED,
  ],
  [OrderRoundStatus.READY]: [
    OrderRoundStatus.DELIVERED,
    OrderRoundStatus.CANCELLED,
  ],
  [OrderRoundStatus.DELIVERED]: [],
  [OrderRoundStatus.CANCELLED]: [],
};

const OPEN_ROUND_STATUSES = [
  OrderRoundStatus.PENDING,
  OrderRoundStatus.PREPARING,
  OrderRoundStatus.READY,
];

const roundInclude: Prisma.OrderRoundInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: {
      extras: true,
      exclusions: {
        include: {
          ingredient: {
            select: {
              id: true,
              name: true,
              baseUnit: true,
              displayUnit: true,
            },
          },
        },
      },
    },
  },
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    include: {
      changedBy: { select: { id: true, name: true, username: true } },
    },
  },
};

const orderInclude: Prisma.OrderInclude = {
  rounds: { orderBy: { createdAt: 'asc' }, include: roundInclude },
  user: { select: { id: true, name: true, username: true } },
  payments: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      method: true,
      amount: true,
      status: true,
      paidAt: true,
      confirmedAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, username: true } },
      confirmedBy: { select: { id: true, name: true, username: true } },
    },
  },
};

const kitchenInclude: Prisma.OrderRoundInclude = {
  items: { include: { extras: true, exclusions: true } },
  order: {
    select: {
      id: true,
      tableNumber: true,
      isTakeaway: true,
      status: true,
      total: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
    },
  },
};

export interface OrderFilters {
  status?: OrderStatus;
  limit?: number;
  offset?: number;
}

export interface ConsumptionWarning {
  ingredientId: string;
  name: string;
  stockAfter: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrdersEventsService,
  ) {}

  // --------------------------------------------------------------------------
  // Cuentas (pedidos)
  // --------------------------------------------------------------------------

  async create(
    organizationId: string | null,
    userId: string,
    dto: CreateOrderDto,
    branchId: string | null = null,
  ) {
    const idempotencyKey = dto.idempotencyKey?.trim() || null;

    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey },
        include: orderInclude,
      });

      if (existing) {
        if (existing.organizationId !== organizationId) {
          throw new ConflictException('La clave de idempotencia ya está en uso');
        }

        return { ...existing, duplicated: true };
      }
    }

    const created = await this.prisma.order.create({
      data: {
        organizationId: organizationId ?? undefined,
        branchId: branchId ?? undefined,
        userId,
        tableNumber: dto.tableNumber?.trim() || null,
        isTakeaway: dto.isTakeaway ?? false,
        idempotencyKey,
      },
      include: orderInclude,
    });

    this.events.publish({ type: 'ORDER_CREATED', orderId: created.id });

    return created;
  }

  list(
    organizationId: string | null,
    filters: OrderFilters = {},
    branchId: string | null = null,
  ) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    return this.prisma.order
      .findMany({
        where: {
          organizationId: organizationId ?? undefined,
          ...(branchId ? { branchId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        include: {
          branch: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, username: true } },
          payments: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              method: true,
              amount: true,
              status: true,
              paidAt: true,
              confirmedAt: true,
              createdAt: true,
              user: { select: { id: true, name: true, username: true } },
              confirmedBy: { select: { id: true, name: true, username: true } },
            },
          },
          rounds: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              status: true,
              sentAt: true,
              createdAt: true,
              _count: { select: { items: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      })
      .then((orders) => orders.map((order) => this.withBalance(order)));
  }

  async get(organizationId: string | null, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return this.withBalance(order);
  }

  // --------------------------------------------------------------------------
  // Rondas (comandas)
  // --------------------------------------------------------------------------

  async sendRound(
    organizationId: string | null,
    userId: string,
    orderId: string,
    dto: SendRoundDto,
  ) {
    const order = await this.getOrderRow(organizationId, orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('El pedido ya no está abierto');
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || null;

    if (idempotencyKey) {
      const existing = await this.prisma.orderRound.findUnique({
        where: { idempotencyKey },
        include: roundInclude,
      });

      if (existing) {
        if (existing.orderId !== orderId) {
          throw new ConflictException('La clave de idempotencia ya está en uso');
        }

        return { ...existing, duplicated: true };
      }
    }

    // La tasa del negocio es la que se aplica salvo que el artículo tenga una
    // propia (importaciones antiguas). Se lee una vez por ronda.
    const organization = organizationId ? await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { taxRate: true },
    }) : { taxRate: new Prisma.Decimal(0) };

    const items = await this.buildItems(
      organizationId,
      dto.items,
      organization.taxRate,
    );

    const round = await this.prisma.$transaction(async (tx) => {
      const created = await tx.orderRound.create({
        data: {
          orderId,
          status: OrderRoundStatus.PENDING,
          sentAt: new Date(),
          idempotencyKey,
          items: { create: items },
        },
        include: roundInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderRoundId: created.id,
          previousStatus: null,
          newStatus: OrderRoundStatus.PENDING,
          changedById: userId,
          reason: 'Ronda enviada a cocina',
        },
      });

      await this.recalculateTotals(tx, orderId);

      return created;
    });

    this.events.publish({
      type: 'ROUND_CREATED',
      orderId,
      roundId: round.id,
      status: round.status,
    });

    return round;
  }

  /**
   * Cambia el estado de una ronda.
   *
   * - `PENDING → PREPARING` descuenta inventario de forma atómica e idempotente.
   * - Cancelar después de empezar la preparación **no** devuelve stock
   *   automáticamente (`plan.md` §6.6): se corrige con un ajuste auditado.
   */
  async transitionRound(
    organizationId: string | null,
    userId: string,
    orderId: string,
    roundId: string,
    dto: TransitionRoundDto,
  ) {
    const order = await this.getOrderRow(organizationId, orderId);

    const round = await this.prisma.orderRound.findFirst({
      where: { id: roundId, orderId },
      select: { id: true, status: true },
    });

    if (!round) {
      throw new NotFoundException('Ronda no encontrada');
    }

    if (!ALLOWED_TRANSITIONS[round.status].includes(dto.status)) {
      throw new BadRequestException(
        `No se puede pasar de ${round.status} a ${dto.status}`,
      );
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Guarda contra dobles clics / reintentos: solo una petición gana.
      const claimed = await tx.orderRound.updateMany({
        where: { id: roundId, orderId, status: round.status },
        data: {
          status: dto.status,
          ...(dto.status === OrderRoundStatus.PREPARING
            ? { startedAt: now }
            : {}),
          ...(dto.status === OrderRoundStatus.READY ? { readyAt: now } : {}),
          ...(dto.status === OrderRoundStatus.DELIVERED
            ? { deliveredAt: now }
            : {}),
          ...(dto.status === OrderRoundStatus.CANCELLED
            ? { cancelledAt: now }
            : {}),
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'La ronda ya cambió de estado; recarga el tablero',
        );
      }

      const warnings =
        dto.status === OrderRoundStatus.PREPARING
          ? await this.consumeRound(tx, organizationId, userId, order, roundId)
          : [];

      await tx.orderStatusHistory.create({
        data: {
          orderRoundId: roundId,
          previousStatus: round.status,
          newStatus: dto.status,
          changedById: userId,
          reason: dto.reason?.trim() || null,
        },
      });

      await this.recalculateTotals(tx, orderId);

      const updated = await tx.orderRound.findUniqueOrThrow({
        where: { id: roundId },
        include: roundInclude,
      });

      return { updated, warnings };
    });

    this.events.publish({
      type: 'ROUND_UPDATED',
      orderId,
      roundId,
      status: dto.status,
    });

    return { ...result.updated, warnings: result.warnings };
  }

  async cancelOrder(
    organizationId: string | null,
    userId: string,
    orderId: string,
    dto: CancelOrderDto = {},
  ) {
    const order = await this.getOrderRow(organizationId, orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('Solo se puede cancelar un pedido abierto');
    }

    // Una cuenta con dinero confirmado no se cancela: primero se reembolsa el
    // pago (acción auditada) y después se cancela la cuenta.
    const confirmedPayments = await this.prisma.payment.count({
      where: { orderId, status: PaymentStatus.CONFIRMED },
    });

    if (confirmedPayments > 0) {
      throw new BadRequestException(
        'La cuenta tiene pagos confirmados; reembólsalos antes de cancelarla',
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const rounds = await tx.orderRound.findMany({
        where: { orderId, status: { in: OPEN_ROUND_STATUSES } },
        select: { id: true, status: true },
      });

      for (const round of rounds) {
        await tx.orderRound.update({
          where: { id: round.id },
          data: { status: OrderRoundStatus.CANCELLED, cancelledAt: now },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderRoundId: round.id,
            previousStatus: round.status,
            newStatus: OrderRoundStatus.CANCELLED,
            changedById: userId,
            reason: dto.reason?.trim() || 'Pedido cancelado',
          },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });
    });

    this.events.publish({ type: 'ORDER_CANCELLED', orderId });

    return this.get(organizationId, orderId);
  }

  // --------------------------------------------------------------------------
  // Cocina
  // --------------------------------------------------------------------------

  kitchenRounds(organizationId: string | null, branchId: string | null = null) {
    return this.prisma.orderRound.findMany({
      where: {
        order: {
          organizationId: organizationId,
          status: OrderStatus.OPEN,
          ...(branchId ? { branchId } : {}),
        },
        status: { in: OPEN_ROUND_STATUSES },
      },
      include: kitchenInclude,
      orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // --------------------------------------------------------------------------
  // Interno
  // --------------------------------------------------------------------------

  /**
   * Añade el importe cobrado y el saldo a una cuenta.
   *
   * Solo cuentan los pagos CONFIRMADOS: un pago pendiente no reduce el saldo
   * (`plan.md` §6.8).
   */
  private withBalance<
    T extends {
      total: Prisma.Decimal;
      payments: Array<{ amount: Prisma.Decimal; status: PaymentStatus }>;
    },
  >(order: T) {
    const paid = order.payments
      .filter((payment) => payment.status === PaymentStatus.CONFIRMED)
      .reduce(
        (sum, payment) => sum.plus(payment.amount),
        new Prisma.Decimal(0),
      );

    return {
      ...order,
      paidTotal: paid.toFixed(2),
      balance: order.total.minus(paid).toFixed(2),
    };
  }

  private async getOrderRow(organizationId: string | null, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: {
        id: true,
        status: true,
        tableNumber: true,
        isTakeaway: true,
        branchId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return order;
  }

  /**
   * Valida líneas contra el catálogo y calcula precios e IVA.
   *
   * El precio del catálogo es final (IVA incluido), así que el importe de la
   * línea es el bruto y el IVA se extrae de él.
   */
  private async buildItems(
    organizationId: string | null,
    items: RoundItemDto[],
    defaultTaxRate: Prisma.Decimal,
  ) {
    const itemIds = [...new Set(items.map((line) => line.itemId))];

    const catalogItems = await this.prisma.item.findMany({
      where: { id: { in: itemIds }, organizationId },
      include: {
        variants: true,
        extras: true,
        ingredientExclusions: true,
      },
    });

    const byId = new Map(catalogItems.map((item) => [item.id, item]));

    return items.map((line) => {
      const item = byId.get(line.itemId);

      if (!item) {
        throw new BadRequestException(
          'Uno de los artículos del pedido no existe en el catálogo',
        );
      }

      if (!item.isActive) {
        throw new BadRequestException(`${item.name} está desactivado`);
      }

      const variant = line.variantId
        ? item.variants.find((candidate) => candidate.id === line.variantId)
        : undefined;

      if (line.variantId && !variant) {
        throw new BadRequestException(
          `La variante no pertenece a ${item.name}`,
        );
      }

      if (variant && !variant.isActive) {
        throw new BadRequestException(
          `La variante ${variant.name} está desactivada`,
        );
      }

      const extras = (line.extras ?? []).map((selection) => {
        const extra = item.extras.find(
          (candidate) => candidate.id === selection.extraId,
        );

        if (!extra) {
          throw new BadRequestException(
            `El extra no pertenece a ${item.name}`,
          );
        }

        if (!extra.isActive) {
          throw new BadRequestException(
            `El extra ${extra.name} está desactivado`,
          );
        }

        return extra;
      });

      const exclusions = (line.excludedIngredientIds ?? []).map(
        (ingredientId) => {
          const allowed = item.ingredientExclusions.some(
            (exclusion) => exclusion.ingredientId === ingredientId,
          );

          if (!allowed) {
            throw new BadRequestException(
              `Ese ingrediente no se puede quitar de ${item.name}`,
            );
          }

          return { ingredientId };
        },
      );

      const quantity = line.quantity ?? 1;

      const unitPrice = extras.reduce(
        (sum, extra) => sum.plus(extra.price),
        item.price.plus(variant?.priceAdjust ?? 0),
      );

      const subtotal = unitPrice.times(quantity).toDecimalPlaces(2);
      const taxRate = item.taxRate ?? defaultTaxRate;
      const taxAmount = taxRate.gt(0)
        ? subtotal.minus(subtotal.dividedBy(taxRate.plus(1))).toDecimalPlaces(2)
        : new Prisma.Decimal(0);

      return {
        itemId: item.id,
        itemVariantId: variant?.id ?? null,
        itemName: item.name,
        variantName: variant?.name ?? null,
        itemPrice: unitPrice.toDecimalPlaces(2),
        taxRate,
        taxAmount,
        quantity,
        notes: line.notes?.trim() || null,
        subtotal,
        extras: {
          create: extras.map((extra) => ({
            itemExtraId: extra.id,
            extraName: extra.name,
            extraPrice: extra.price,
          })),
        },
        exclusions: { create: exclusions },
      };
    });
  }

  /** Recalcula los totales de la cuenta ignorando las rondas canceladas. */
  private async recalculateTotals(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    const items = await tx.orderItem.findMany({
      where: {
        orderRound: {
          orderId,
          status: { not: OrderRoundStatus.CANCELLED },
        },
      },
      select: { subtotal: true, taxAmount: true },
    });

    const gross = items.reduce(
      (sum, item) => sum.plus(item.subtotal),
      new Prisma.Decimal(0),
    );
    const tax = items.reduce(
      (sum, item) => sum.plus(item.taxAmount),
      new Prisma.Decimal(0),
    );

    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: gross.minus(tax).toDecimalPlaces(2),
        taxTotal: tax.toDecimalPlaces(2),
        total: gross.toDecimalPlaces(2),
      },
    });
  }

  /**
   * Descuenta inventario de una ronda al empezar la preparación.
   *
   * Idempotente por `dedupeKey = round:{roundId}:{ingredientId}`. El stock
   * puede quedar negativo: la venta ya ocurrió y el plan pide advertencia, no
   * bloqueo (`plan.md` §13).
   */
  private async consumeRound(
    tx: Prisma.TransactionClient,
    organizationId: string | null,
    userId: string,
    order: {
      tableNumber: string | null;
      isTakeaway: boolean;
      branchId: string | null;
    },
    roundId: string,
  ): Promise<ConsumptionWarning[]> {
    const items = await tx.orderItem.findMany({
      where: { orderRoundId: roundId },
      include: {
        extras: true,
        exclusions: true,
        ingredientChoices: true,
        item: {
          include: {
            variants: { select: { id: true, recipeFactor: true } },
            recipes: {
              where: { isActive: true },
              include: { ingredients: { include: { options: true } } },
            },
            extras: { include: { ingredients: true } },
            comboComponents: {
              include: {
                variant: { select: { id: true, recipeFactor: true } },
                componentItem: {
                  include: {
                    recipes: {
                      where: { isActive: true },
                      include: { ingredients: { include: { options: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const totals = new Map<string, Prisma.Decimal>();

    for (const item of items) {
      const lineQuantity = new Prisma.Decimal(item.quantity);

      for (const consumption of consumptionForItem(item)) {
        const current =
          totals.get(consumption.ingredientId) ?? new Prisma.Decimal(0);
        totals.set(
          consumption.ingredientId,
          current.plus(consumption.quantity.times(lineQuantity)),
        );
      }
    }

    const warnings: ConsumptionWarning[] = [];
    const reason = order.tableNumber
      ? `Consumo pedido · mesa ${order.tableNumber}`
      : 'Consumo pedido · para llevar';

    for (const [ingredientId, quantity] of totals) {
      if (quantity.lte(0)) {
        continue;
      }

      const dedupeKey = `round:${roundId}:${ingredientId}`;

      const already = await tx.inventoryMovement.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });

      if (already) {
        continue;
      }

      if (!organizationId) {
        continue; // Skip if no organization (should not happen for orders)
      }

      let stockAfter: Prisma.Decimal;
      let ingredientName: string;
      let displayUnit: UnitCode;

      if (order.branchId) {
        const amount = quantity.toString();

        await tx.$executeRaw`
          INSERT INTO "BranchStock" ("id", "branchId", "ingredientId", "quantity", "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, ${order.branchId}, ${ingredientId}, 0, NOW(), NOW())
          ON CONFLICT ("branchId", "ingredientId") DO NOTHING
        `;

        const branchRows = await tx.$queryRaw<
          Array<{ quantity: Prisma.Decimal }>
        >`
          UPDATE "BranchStock"
          SET "quantity" = "quantity" - CAST(${amount} AS numeric),
              "updatedAt" = NOW()
          WHERE "branchId" = ${order.branchId}
            AND "ingredientId" = ${ingredientId}
          RETURNING "quantity"
        `;

        if (branchRows.length === 0) {
          continue;
        }

        const totals = await tx.$queryRaw<
          Array<{
            currentStock: Prisma.Decimal;
            name: string;
            displayUnit: UnitCode;
          }>
        >`
          UPDATE "Ingredient"
          SET "currentStock" = "currentStock" - CAST(${amount} AS numeric),
              "updatedAt" = NOW()
          WHERE "id" = ${ingredientId}
            AND "organizationId" = ${organizationId}
          RETURNING "currentStock", "name", "displayUnit"
        `;

        if (totals.length === 0) {
          continue;
        }

        stockAfter = new Prisma.Decimal(branchRows[0].quantity);
        ingredientName = totals[0].name;
        displayUnit = totals[0].displayUnit;
      } else {
        const rows = await tx.$queryRaw<
          Array<{
            currentStock: Prisma.Decimal;
            name: string;
            displayUnit: UnitCode;
          }>
        >`
          UPDATE "Ingredient"
          SET "currentStock" = "currentStock" - CAST(${quantity.toString()} AS numeric),
              "updatedAt" = NOW()
          WHERE "id" = ${ingredientId}
            AND "organizationId" = ${organizationId}
          RETURNING "currentStock", "name", "displayUnit"
        `;

        if (rows.length === 0) {
          continue;
        }

        stockAfter = new Prisma.Decimal(rows[0].currentStock);
        ingredientName = rows[0].name;
        displayUnit = rows[0].displayUnit;
      }

      await tx.inventoryMovement.create({
        data: {
          organizationId,
          branchId: order.branchId,
          ingredientId,
          ingredientName,
          displayUnit,
          userId,
          type: InventoryMovementType.CONSUMPTION,
          quantity: quantity.negated(),
          stockAfter,
          reason,
          referenceType: 'ORDER_ROUND',
          referenceId: roundId,
          dedupeKey,
        },
      });

      if (stockAfter.lt(0)) {
        warnings.push({
          ingredientId,
          name: ingredientName,
          stockAfter: stockAfter.toFixed(4),
        });
      }
    }

    return warnings;
  }
}

interface ConsumptionLine {
  ingredientId: string;
  quantity: Prisma.Decimal;
}

interface RecipeLineLike {
  id: string;
  ingredientId: string;
  quantity: Prisma.Decimal;
  options: Array<{ ingredientId: string; quantity: Prisma.Decimal }>;
}

interface RecipeLike {
  variantId: string | null;
  ingredients: RecipeLineLike[];
}

interface VariantLike {
  id: string;
  recipeFactor: Prisma.Decimal;
}

/**
 * Consumo de inventario de una línea (por unidad pedida).
 *
 * - Artículo normal: receta de la variante o, si no existe, la base escalada
 *   por `recipeFactor` de la presentación (Regular = 1).
 * - Combo: recetas de sus componentes (no hay combos anidados).
 * - Alternativas: se usa la opción elegida en el pedido o el insumo default.
 * - Extras: consumo declarado en el catálogo del extra.
 * - Exclusiones: el ingrediente que el cliente quitó no se descuenta.
 */
function consumptionForItem(item: {
  itemVariantId: string | null;
  extras: Array<{ itemExtraId: string | null }>;
  exclusions: Array<{ ingredientId: string }>;
  ingredientChoices: Array<{
    recipeIngredientId: string;
    ingredientId: string;
  }>;
  item: {
    isCombo: boolean;
    variants: VariantLike[];
    recipes: RecipeLike[];
    extras: Array<{
      id: string;
      ingredients: Array<{
        ingredientId: string;
        quantity: Prisma.Decimal;
      }>;
    }>;
    comboComponents: Array<{
      componentVariantId: string | null;
      quantity: number;
      variant: VariantLike | null;
      componentItem: {
        recipes: RecipeLike[];
      };
    }>;
  };
}): ConsumptionLine[] {
  const excluded = new Set(
    item.exclusions.map((exclusion) => exclusion.ingredientId),
  );
  const choices = new Map(
    item.ingredientChoices.map((choice) => [
      choice.recipeIngredientId,
      choice.ingredientId,
    ]),
  );
  const lines: ConsumptionLine[] = [];

  const pushRecipe = (
    recipes: RecipeLike[],
    variantId: string | null,
    multiplier: Prisma.Decimal,
    variants: VariantLike[],
  ) => {
    const variantRecipe = recipes.find(
      (candidate) => candidate.variantId === variantId,
    );
    const recipe =
      variantRecipe ?? recipes.find((candidate) => candidate.variantId === null);

    if (!recipe) {
      return;
    }

    // La receta propia de la presentación ya tiene sus cantidades; la receta
    // base se escala con el factor de la presentación (Regular = 1).
    const factor = variantRecipe
      ? new Prisma.Decimal(1)
      : (variants.find((variant) => variant.id === variantId)?.recipeFactor ??
        new Prisma.Decimal(1));
    const totalMultiplier = multiplier.times(factor);

    for (const line of recipe.ingredients) {
      const chosenIngredientId = choices.get(line.id);
      const option = chosenIngredientId
        ? line.options.find(
            (candidate) => candidate.ingredientId === chosenIngredientId,
          )
        : undefined;
      const ingredientId = option?.ingredientId ?? line.ingredientId;
      const quantity = option?.quantity ?? line.quantity;

      if (excluded.has(ingredientId)) {
        continue;
      }

      lines.push({
        ingredientId,
        quantity: quantity.times(totalMultiplier),
      });
    }
  };

  if (item.item.isCombo) {
    for (const component of item.item.comboComponents) {
      pushRecipe(
        component.componentItem.recipes,
        component.componentVariantId,
        new Prisma.Decimal(component.quantity),
        component.variant ? [component.variant] : [],
      );
    }
  } else {
    pushRecipe(
      item.item.recipes,
      item.itemVariantId,
      new Prisma.Decimal(1),
      item.item.variants,
    );
  }

  for (const extra of item.extras) {
    const catalogExtra = item.item.extras.find(
      (candidate) => candidate.id === extra.itemExtraId,
    );

    if (!catalogExtra) {
      continue;
    }

    for (const line of catalogExtra.ingredients) {
      lines.push({
        ingredientId: line.ingredientId,
        quantity: line.quantity,
      });
    }
  }

  return lines;
}

