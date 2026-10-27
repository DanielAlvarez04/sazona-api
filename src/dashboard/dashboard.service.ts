import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  OrderRoundStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { rolesHavePermission } from '../common/permissions';

const ACTIVE_ROUNDS = [
  OrderRoundStatus.PENDING,
  OrderRoundStatus.PREPARING,
  OrderRoundStatus.READY,
];

/** Minutos tras los que una comanda pendiente se considera demorada. */
const DELAY_MINUTES = 15;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Datos del panel principal.
   *
   * - Los importes solo se devuelven a quien tiene `reports:read`
   *   (ADMIN/CASHIER). El resto ve métricas operativas con `money: false`.
   * - Todo se agrega en el servidor y filtrado por `organizationId`
   *   (`plan.md` §6.10); el frontend no calcula cifras de negocio.
   */
  async overview(organizationId: string, roles: Role[], days = 7) {
    const money = rolesHavePermission(roles, 'reports:read');
    const range = Math.min(Math.max(days, 1), 90);
    const now = new Date();
    const todayStart = startOfDay(now);
    const since = addDays(todayStart, -(range - 1));

    const [
      todayPayments,
      periodPayments,
      ordersToday,
      openOrders,
      activeRounds,
      ingredients,
      recentOrders,
      topProducts,
      itemsToday,
      preparedRounds,
    ] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          organizationId,
          status: PaymentStatus.CONFIRMED,
          confirmedAt: { gte: todayStart },
        },
        select: { orderId: true, amount: true, method: true },
      }),
      this.prisma.payment.findMany({
        where: {
          organizationId,
          status: PaymentStatus.CONFIRMED,
          confirmedAt: { gte: since },
        },
        select: { amount: true, method: true, confirmedAt: true },
      }),
      this.prisma.order.count({
        where: {
          organizationId,
          createdAt: { gte: todayStart },
          status: { not: OrderStatus.CANCELLED },
        },
      }),
      this.prisma.order.findMany({
        where: { organizationId, status: OrderStatus.OPEN },
        select: { total: true },
      }),
      this.prisma.orderRound.findMany({
        where: {
          order: { organizationId, status: OrderStatus.OPEN },
          status: { in: ACTIVE_ROUNDS },
        },
        select: { status: true, sentAt: true },
      }),
      this.prisma.ingredient.findMany({
        where: { organizationId, isActive: true },
        select: {
          id: true,
          name: true,
          baseUnit: true,
          currentStock: true,
          minStock: true,
        },
      }),
      this.prisma.order.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          tableNumber: true,
          isTakeaway: true,
          status: true,
          total: true,
          createdAt: true,
          user: { select: { name: true, username: true } },
          _count: { select: { rounds: true } },
        },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productName'],
        where: {
          orderRound: {
            status: { not: OrderRoundStatus.CANCELLED },
            order: { organizationId, createdAt: { gte: since } },
          },
        },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      this.prisma.orderItem.aggregate({
        where: {
          orderRound: {
            status: { not: OrderRoundStatus.CANCELLED },
            order: { organizationId, createdAt: { gte: todayStart } },
          },
        },
        _sum: { quantity: true, taxAmount: true },
      }),
      this.prisma.orderRound.findMany({
        where: {
          order: { organizationId, createdAt: { gte: since } },
          startedAt: { not: null },
          readyAt: { not: null },
        },
        select: { startedAt: true, readyAt: true },
      }),
    ]);

    const todaySales = sumDecimals(todayPayments.map((row) => row.amount));
    const paidOrdersToday = new Set(todayPayments.map((row) => row.orderId)).size;
    const periodSales = sumDecimals(periodPayments.map((row) => row.amount));
    const openTotal = sumDecimals(openOrders.map((row) => row.total));

    const byMethod = new Map<PaymentMethod, { total: number; count: number }>();
    for (const payment of periodPayments) {
      const entry = byMethod.get(payment.method) ?? { total: 0, count: 0 };
      entry.total += Number(payment.amount);
      entry.count += 1;
      byMethod.set(payment.method, entry);
    }

    const series = new Map<string, { sales: number; payments: number }>();
    for (let index = 0; index < range; index += 1) {
      series.set(dayKey(addDays(since, index)), { sales: 0, payments: 0 });
    }
    for (const payment of periodPayments) {
      if (!payment.confirmedAt) continue;
      const key = dayKey(payment.confirmedAt);
      const entry = series.get(key);
      if (!entry) continue;
      entry.sales += Number(payment.amount);
      entry.payments += 1;
    }

    const lowStock = ingredients
      .filter((ingredient) => ingredient.currentStock.lte(ingredient.minStock))
      .map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        baseUnit: ingredient.baseUnit,
        currentStock: Number(ingredient.currentStock),
        minStock: Number(ingredient.minStock),
        deficit: Number(ingredient.minStock.minus(ingredient.currentStock)),
      }))
      .sort((a, b) => b.deficit - a.deficit);

    const prepMinutes = preparedRounds
      .map((round) =>
        round.startedAt && round.readyAt
          ? (round.readyAt.getTime() - round.startedAt.getTime()) / 60000
          : null,
      )
      .filter((value): value is number => value !== null && value >= 0);

    const delayedBefore = new Date(now.getTime() - DELAY_MINUTES * 60000);

    return {
      generatedAt: now.toISOString(),
      days: range,
      money,
      today: {
        sales: money ? round(todaySales) : null,
        payments: todayPayments.length,
        orders: paidOrdersToday || ordersToday,
        averageTicket:
          money && paidOrdersToday > 0 ? round(todaySales / paidOrdersToday) : null,
        itemsSold: itemsToday._sum.quantity ?? 0,
        taxTotal: money ? round(Number(itemsToday._sum.taxAmount ?? 0)) : null,
      },
      period: {
        sales: money ? round(periodSales) : null,
        payments: periodPayments.length,
        averageTicket:
          money && periodPayments.length > 0
            ? round(periodSales / periodPayments.length)
            : null,
      },
      paymentsByMethod: [...byMethod].map(([method, value]) => ({
        method,
        total: money ? round(value.total) : null,
        count: value.count,
      })),
      salesSeries: [...series].map(([date, value]) => ({
        date,
        sales: money ? round(value.sales) : null,
        payments: value.payments,
      })),
      topProducts: topProducts.map((row) => ({
        name: row.productName,
        quantity: row._sum.quantity ?? 0,
        revenue: money ? round(Number(row._sum.subtotal ?? 0)) : null,
      })),
      inventory: {
        lowStockCount: lowStock.length,
        alerts: lowStock.slice(0, 5),
      },
      kitchen: {
        pending: activeRounds.filter(
          (round) => round.status === OrderRoundStatus.PENDING,
        ).length,
        preparing: activeRounds.filter(
          (round) => round.status === OrderRoundStatus.PREPARING,
        ).length,
        ready: activeRounds.filter(
          (round) => round.status === OrderRoundStatus.READY,
        ).length,
        delayed: activeRounds.filter(
          (round) =>
            round.status === OrderRoundStatus.PENDING &&
            round.sentAt !== null &&
            round.sentAt < delayedBefore,
        ).length,
        averagePrepMinutes:
          prepMinutes.length > 0
            ? Math.round(
                prepMinutes.reduce((sum, value) => sum + value, 0) /
                  prepMinutes.length,
              )
            : null,
      },
      openOrders: {
        count: openOrders.length,
        total: money ? round(openTotal) : null,
      },
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        tableNumber: order.tableNumber,
        isTakeaway: order.isTakeaway,
        status: order.status,
        total: money ? Number(order.total) : null,
        createdAt: order.createdAt.toISOString(),
        rounds: order._count.rounds,
        user: order.user?.name ?? order.user?.username ?? null,
      })),
    };
  }

  /** Reporte de ventas: totales, métodos de pago, serie diaria y productos. */
  async salesReport(organizationId: string, from: Date, to: Date) {
    const [payments, topProducts, orders] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          organizationId,
          status: PaymentStatus.CONFIRMED,
          confirmedAt: { gte: from, lte: to },
        },
        select: {
          amount: true,
          method: true,
          confirmedAt: true,
          user: { select: { name: true, username: true } },
        },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productName'],
        where: {
          orderRound: {
            status: { not: OrderRoundStatus.CANCELLED },
            order: { organizationId, createdAt: { gte: from, lte: to } },
          },
        },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      this.prisma.order.count({
        where: {
          organizationId,
          createdAt: { gte: from, lte: to },
          status: { not: OrderStatus.CANCELLED },
        },
      }),
    ]);

    const total = sumDecimals(payments.map((payment) => payment.amount));

    const byMethod = new Map<PaymentMethod, { total: number; count: number }>();
    const byDay = new Map<string, { sales: number; count: number }>();
    const byCashier = new Map<string, { total: number; count: number }>();

    for (const payment of payments) {
      const method = byMethod.get(payment.method) ?? { total: 0, count: 0 };
      method.total += Number(payment.amount);
      method.count += 1;
      byMethod.set(payment.method, method);

      if (payment.confirmedAt) {
        const key = dayKey(payment.confirmedAt);
        const day = byDay.get(key) ?? { sales: 0, count: 0 };
        day.sales += Number(payment.amount);
        day.count += 1;
        byDay.set(key, day);
      }

      const cashier =
        payment.user?.name ?? payment.user?.username ?? 'Sin usuario';
      const entry = byCashier.get(cashier) ?? { total: 0, count: 0 };
      entry.total += Number(payment.amount);
      entry.count += 1;
      byCashier.set(cashier, entry);
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        sales: round(total),
        payments: payments.length,
        orders,
        averageTicket:
          payments.length > 0 ? round(total / payments.length) : 0,
      },
      byMethod: [...byMethod].map(([method, value]) => ({
        method,
        total: round(value.total),
        count: value.count,
      })),
      byDay: [...byDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({
          date,
          sales: round(value.sales),
          count: value.count,
        })),
      byCashier: [...byCashier]
        .map(([name, value]) => ({
          name,
          total: round(value.total),
          count: value.count,
        }))
        .sort((a, b) => b.total - a.total),
      topProducts: topProducts.map((row) => ({
        name: row.productName,
        quantity: row._sum.quantity ?? 0,
        revenue: round(Number(row._sum.subtotal ?? 0)),
      })),
    };
  }

  /** Reporte de inventario: movimientos por tipo, consumo y alertas. */
  async inventoryReport(organizationId: string, from: Date, to: Date) {
    const [movements, ingredients] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where: { organizationId, createdAt: { gte: from, lte: to } },
        select: {
          type: true,
          quantity: true,
          ingredient: { select: { name: true, baseUnit: true } },
        },
      }),
      this.prisma.ingredient.findMany({
        where: { organizationId, isActive: true },
        select: {
          id: true,
          name: true,
          baseUnit: true,
          currentStock: true,
          minStock: true,
        },
      }),
    ]);

    const byType = new Map<InventoryMovementType, { count: number; quantity: number }>();
    const consumption = new Map<
      string,
      { name: string; baseUnit: string; quantity: number }
    >();

    for (const movement of movements) {
      const entry = byType.get(movement.type) ?? { count: 0, quantity: 0 };
      entry.count += 1;
      entry.quantity += Math.abs(Number(movement.quantity));
      byType.set(movement.type, entry);

      if (movement.type !== InventoryMovementType.CONSUMPTION) continue;

      const key = movement.ingredient.name;
      const current = consumption.get(key) ?? {
        name: movement.ingredient.name,
        baseUnit: movement.ingredient.baseUnit,
        quantity: 0,
      };
      current.quantity += Math.abs(Number(movement.quantity));
      consumption.set(key, current);
    }

    const lowStock = ingredients
      .filter((ingredient) => ingredient.currentStock.lte(ingredient.minStock))
      .map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        baseUnit: ingredient.baseUnit,
        currentStock: Number(ingredient.currentStock),
        minStock: Number(ingredient.minStock),
        deficit: Number(ingredient.minStock.minus(ingredient.currentStock)),
      }))
      .sort((a, b) => b.deficit - a.deficit);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      movements: [...byType].map(([type, value]) => ({
        type,
        count: value.count,
        quantity: round(value.quantity),
      })),
      consumption: [...consumption.values()]
        .map((row) => ({ ...row, quantity: round(row.quantity) }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10),
      lowStock,
    };
  }

  /** Reporte de cocina: volumen, tiempos medios y productos preparados. */
  async kitchenReport(organizationId: string, from: Date, to: Date) {
    const rounds = await this.prisma.orderRound.findMany({
      where: { order: { organizationId, createdAt: { gte: from, lte: to } } },
      select: {
        status: true,
        sentAt: true,
        startedAt: true,
        readyAt: true,
        deliveredAt: true,
      },
    });

    const byStatus = new Map<OrderRoundStatus, number>();
    const byDay = new Map<string, number>();
    const wait: number[] = [];
    const prep: number[] = [];
    const delivery: number[] = [];
    const total: number[] = [];

    for (const round of rounds) {
      byStatus.set(round.status, (byStatus.get(round.status) ?? 0) + 1);

      if (round.sentAt) {
        const key = dayKey(round.sentAt);
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
      }

      if (round.sentAt && round.startedAt) {
        wait.push((round.startedAt.getTime() - round.sentAt.getTime()) / 60000);
      }

      if (round.startedAt && round.readyAt) {
        prep.push((round.readyAt.getTime() - round.startedAt.getTime()) / 60000);
      }

      if (round.readyAt && round.deliveredAt) {
        delivery.push(
          (round.deliveredAt.getTime() - round.readyAt.getTime()) / 60000,
        );
      }

      if (round.sentAt && round.deliveredAt) {
        total.push(
          (round.deliveredAt.getTime() - round.sentAt.getTime()) / 60000,
        );
      }
    }

    const average = (values: number[]) =>
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        rounds: rounds.length,
        averageWaitMinutes: average(wait),
        averagePrepMinutes: average(prep),
        averageDeliveryMinutes: average(delivery),
        averageTotalMinutes: average(total),
      },
      byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
      byDay: [...byDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
    };
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Clave `YYYY-MM-DD` en hora local del servidor. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function sumDecimals(values: Array<Prisma.Decimal | number>): number {
  return values.reduce<number>(
    (sum, value) => sum + Number(value),
    0,
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
