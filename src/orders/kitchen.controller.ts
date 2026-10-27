import { Controller, Get, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../auth/auth.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrdersService } from './orders.service';
import { OrdersEventsService, type OrderEvent } from './orders.events';

@ApiTags('kitchen')
@Controller('kitchen')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KitchenController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrdersEventsService,
  ) {}

  @ApiOperation({ summary: 'Rondas activas para el tablero de cocina' })
  @Get('rounds')
  rounds(@CurrentUser() user: JwtUser) {
    return this.orders.kitchenRounds(user.organizationId);
  }

  /**
   * Flujo SSE con los cambios de pedidos.
   *
   * El cliente abre un `EventSource` con credenciales y refresca el tablero
   * cuando llega un evento. Si el navegador no soporta SSE o la conexión se
   * cae, el tablero sigue actualizándose por sondeo periódico.
   */
  @ApiOperation({ summary: 'Cambios de pedidos en tiempo real (SSE)' })
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.events.stream.pipe(
      map((event: OrderEvent) => ({ data: event }) as MessageEvent),
    );
  }
}
