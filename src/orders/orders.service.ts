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
          ingredient: { select: { id: true, name: true, baseUnit: true } },
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

  async create(organizationId: string, userId: string, dto: CreateOrderDto) {
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
        organizationId,
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

  list(organizationId: string, filters: OrderFilters = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    return this.prisma.order
      .findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
        },
        include: {
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

  async get(organizationId: string, orderId: string) {
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
    organizationId: string,
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

    // La tasa del negocio es la que se aplica salvo que el producto tenga una
    // propia (importaciones antiguas). Se lee una vez por ronda.
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { taxRate: true },
    });

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
    organizationId: string,
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
    organizationId: string,
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

  kitchenRounds(organizationId: string) {
    return this.prisma.orderRound.findMany({
      where: {
        order: { organizationId, status: OrderStatus.OPEN },
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

  private async getOrderRow(organizationId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: {
        id: true,
        status: true,
        tableNumber: true,
        isTakeaway: true,
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
    organizationId: string,
    items: RoundItemDto[],
    defaultTaxRate: Prisma.Decimal,
  ) {
    const productIds = [...new Set(items.map((item) => item.productId))];

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      include: {
        variants: true,
        extras: true,
        ingredientExclusions: true,
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));

    return items.map((item) => {
      const product = byId.get(item.productId);

      if (!product) {
        throw new BadRequestException(
          'Uno de los productos del pedido no existe en el catálogo',
        );
      }

      if (!product.isActive) {
        throw new BadRequestException(`${product.name} está desactivado`);
      }

      const variant = item.variantId
        ? product.variants.find((candidate) => candidate.id === item.variantId)
        : undefined;

      if (item.variantId && !variant) {
        throw new BadRequestException(
          `La variante no pertenece a ${product.name}`,
        );
      }

      if (variant && !variant.isActive) {
        throw new BadRequestException(
          `La variante ${variant.name} está desactivada`,
        );
      }

      const extras = (item.extras ?? []).map((selection) => {
        const extra = product.extras.find(
          (candidate) => candidate.id === selection.extraId,
        );

        if (!extra) {
          throw new BadRequestException(
            `El extra no pertenece a ${product.name}`,
          );
        }

        if (!extra.isActive) {
          throw new BadRequestException(
            `El extra ${extra.name} está desactivado`,
          );
        }

        return extra;
      });

      const exclusions = (item.excludedIngredientIds ?? []).map(
        (ingredientId) => {
          const allowed = product.ingredientExclusions.some(
            (exclusion) => exclusion.ingredientId === ingredientId,
          );

          if (!allowed) {
            throw new BadRequestException(
              `Ese ingrediente no se puede quitar de ${product.name}`,
            );
          }

          return { ingredientId };
        },
      );

      const quantity = item.quantity ?? 1;

      const unitPrice = extras.reduce(
        (sum, extra) => sum.plus(extra.price),
        product.price.plus(variant?.priceAdjust ?? 0),
      );

      const subtotal = unitPrice.times(quantity).toDecimalPlaces(2);
      const taxRate = product.taxRate ?? defaultTaxRate;
      const taxAmount = taxRate.gt(0)
        ? subtotal.minus(subtotal.dividedBy(taxRate.plus(1))).toDecimalPlaces(2)
        : new Prisma.Decimal(0);

      return {
        productId: product.id,
        productVariantId: variant?.id ?? null,
        productName: product.name,
        variantName: variant?.name ?? null,
        productPrice: unitPrice.toDecimalPlaces(2),
        taxRate,
        taxAmount,
        quantity,
        notes: item.notes?.trim() || null,
        subtotal,
        extras: {
          create: extras.map((extra) => ({
            productExtraId: extra.id,
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
    organizationId: string,
    userId: string,
    order: { tableNumber: string | null; isTakeaway: boolean },
    roundId: string,
  ): Promise<ConsumptionWarning[]> {
    const items = await tx.orderItem.findMany({
      where: { orderRoundId: roundId },
      include: {
        extras: true,
        exclusions: true,
        product: {
          include: {
            recipes: {
              where: { isActive: true },
              include: { ingredients: true },
            },
            extras: { include: { ingredients: true } },
            comboComponents: {
              include: {
                component: {
                  include: {
                    recipes: {
                      where: { isActive: true },
                      include: { ingredients: true },
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

      const rows = await tx.$queryRaw<
        Array<{ currentStock: Prisma.Decimal; name: string }>
      >`
        UPDATE "Ingredient"
        SET "currentStock" = "currentStock" - CAST(${quantity.toString()} AS numeric),
            "updatedAt" = NOW()
        WHERE "id" = ${ingredientId}
          AND "organizationId" = ${organizationId}
        RETURNING "currentStock", "name"
      `;

      if (rows.length === 0) {
        continue;
      }

      const stockAfter = new Prisma.Decimal(rows[0].currentStock);

      await tx.inventoryMovement.create({
        data: {
          organizationId,
          ingredientId,
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
          name: rows[0].name,
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

/**
 * Consumo de inventario de una línea (por unidad pedida).
 *
 * - Producto normal: receta de la variante o, si no existe, la base.
 * - Combo: recetas de sus componentes (no hay combos anidados).
 * - Extras: consumo declarado en el catálogo del extra.
 * - Exclusiones: el ingrediente que el cliente quitó no se descuenta.
 */
function consumptionForItem(item: {
  productVariantId: string | null;
  extras: Array<{ productExtraId: string | null }>;
  exclusions: Array<{ ingredientId: string }>;
  product: {
    isCombo: boolean;
    recipes: Array<{
      variantId: string | null;
      ingredients: Array<{ ingredientId: string; quantity: Prisma.Decimal }>;
    }>;
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
      component: {
        recipes: Array<{
          variantId: string | null;
          ingredients: Array<{
            ingredientId: string;
            quantity: Prisma.Decimal;
          }>;
        }>;
      };
    }>;
  };
}): ConsumptionLine[] {
  const excluded = new Set(
    item.exclusions.map((exclusion) => exclusion.ingredientId),
  );
  const lines: ConsumptionLine[] = [];

  const pushRecipe = (
    recipes: Array<{
      variantId: string | null;
      ingredients: Array<{ ingredientId: string; quantity: Prisma.Decimal }>;
    }>,
    variantId: string | null,
    multiplier: Prisma.Decimal,
  ) => {
    const recipe =
      recipes.find((candidate) => candidate.variantId === variantId) ??
      recipes.find((candidate) => candidate.variantId === null);

    if (!recipe) {
      return;
    }

    for (const line of recipe.ingredients) {
      if (excluded.has(line.ingredientId)) {
        continue;
      }

      lines.push({
        ingredientId: line.ingredientId,
        quantity: line.quantity.times(multiplier),
      });
    }
  };

  if (item.product.isCombo) {
    for (const component of item.product.comboComponents) {
      pushRecipe(
        component.component.recipes,
        component.componentVariantId,
        new Prisma.Decimal(component.quantity),
      );
    }
  } else {
    pushRecipe(item.product.recipes, item.productVariantId, new Prisma.Decimal(1));
  }

  for (const extra of item.extras) {
    const catalogExtra = item.product.extras.find(
      (candidate) => candidate.id === extra.productExtraId,
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
