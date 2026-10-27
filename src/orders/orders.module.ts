import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { KitchenController } from './kitchen.controller';
import { OrdersService } from './orders.service';
import { OrdersEventsService } from './orders.events';

@Module({
  controllers: [OrdersController, KitchenController],
  providers: [OrdersService, OrdersEventsService],
  exports: [OrdersEventsService],
})
export class OrdersModule {}
