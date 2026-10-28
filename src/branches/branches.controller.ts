import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/auth.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('branches')
@Controller('branches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @ApiOperation({ summary: 'Listar sucursales de la organización' })
  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.branches.list(user.organizationId, user.sub);
  }

  @ApiOperation({ summary: 'Crear una sucursal' })
  @RequirePermissions('organization:manage')
  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateBranchDto) {
    return this.branches.create(user.organizationId, dto);
  }

  @ApiOperation({ summary: 'Actualizar una sucursal' })
  @RequirePermissions('organization:manage')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branches.update(user.organizationId, id, dto);
  }

  @ApiOperation({ summary: 'Desactivar una sucursal (soft delete)' })
  @RequirePermissions('organization:manage')
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.branches.deactivate(user.organizationId, id);
  }
}
