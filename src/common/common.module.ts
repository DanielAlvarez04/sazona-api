import { Global, Module } from '@nestjs/common';
import { QuantityConverter } from './quantity-converter.service';

@Global()
@Module({
  providers: [QuantityConverter],
  exports: [QuantityConverter],
})
export class CommonModule {}
