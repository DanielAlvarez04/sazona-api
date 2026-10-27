import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UNITS } from '../common/units';

@ApiTags('catalog')
@Controller('catalog/units')
@UseGuards(JwtAuthGuard)
export class UnitsController {
  @ApiOperation({ summary: 'Unidades de medida soportadas' })
  @Get()
  list() {
    return UNITS;
  }
}
