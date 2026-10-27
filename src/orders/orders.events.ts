import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

export type OrderEventType =
  | 'ORDER_CREATED'
  | 'ORDER_CLOSED'
  | 'ORDER_CANCELLED'
  | 'ROUND_CREATED'
  | 'ROUND_UPDATED';

export interface OrderEvent {
  type: OrderEventType;
  orderId: string;
  roundId?: string;
  status?: string;
  at: string;
}

/**
 * Difusión de cambios de pedidos para el tablero de cocina.
 *
 * En memoria: suficiente para una sola instancia de la API (el entorno actual).
 * Si algún día se despliegan varias instancias, habría que sustituirlo por
 * Redis/pub-sub manteniendo el mismo contrato del flujo SSE.
 */
@Injectable()
export class OrdersEventsService {
  private readonly subject = new Subject<OrderEvent>();

  get stream(): Observable<OrderEvent> {
    return this.subject.asObservable();
  }

  publish(event: Omit<OrderEvent, 'at'>): void {
    this.subject.next({ ...event, at: new Date().toISOString() });
  }
}
