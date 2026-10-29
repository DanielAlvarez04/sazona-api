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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../auth/auth.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProductsService } from './products.service';
import { CatalogImportService } from './catalog-import.service';
import {
  CreateExtraDto,
  CreateProductDto,
  CreateVariantDto,
  ReplaceComboComponentsDto,
  ReplaceExclusionsDto,
  UpdateExtraDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { ImportProductsDto } from './dto/import.dto';

@ApiTags('catalog')
@Controller('catalog/products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly importer: CatalogImportService,
  ) {}

  @ApiOperation({ summary: 'Listar artículos del catálogo' })
  @Get()
  list(
    @CurrentUser() user: JwtUser,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('onlyCombos') onlyCombos?: string,
  ) {
    return this.products.list(user.organizationId, {
      search,
      categoryId,
      includeInactive: includeInactive === 'true',
      onlyCombos: onlyCombos === 'true',
    });
  }

  @ApiOperation({ summary: 'Detalle de un artículo' })
  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.products.findOne(user.organizationId, id);
  }

  @ApiOperation({ summary: 'Crear artículo con variantes, extras y combo' })
  @RequirePermissions('catalog:manage')
  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateProductDto) {
    return this.products.create(user.organizationId, dto);
  }

  @ApiOperation({ summary: 'Importar artículos desde CSV' })
  @RequirePermissions('catalog:manage')
  @HttpCode(HttpStatus.OK)
  @Post('import')
  import(
    @CurrentUser() user: JwtUser,
    @Body() dto: ImportProductsDto,
  ) {
    return this.importer.importProducts(
      user.organizationId,
      dto.csv,
      dto.dryRun ?? false,
    );
  }

  @ApiOperation({ summary: 'Editar datos generales del artículo' })
  @RequirePermissions('catalog:manage')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user.organizationId, id, dto);
  }

  @ApiOperation({ summary: 'Desactivar artículo' })
  @RequirePermissions('catalog:manage')
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.products.deactivate(user.organizationId, id);
  }

  // --------------------------------------------------------------------------
  // Variantes
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: 'Añadir variante al artículo' })
  @RequirePermissions('catalog:manage')
  @Post(':id/variants')
  createVariant(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.products.createVariant(user.organizationId, id, dto);
  }

  @ApiOperation({ summary: 'Editar variante' })
  @RequirePermissions('catalog:manage')
  @Patch(':id/variants/:variantId')
  updateVariant(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.products.updateVariant(
      user.organizationId,
      id,
      variantId,
      dto,
    );
  }

  @ApiOperation({ summary: 'Desactivar variante' })
  @RequirePermissions('catalog:manage')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/variants/:variantId')
  deactivateVariant(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ) {
    return this.products.deactivateVariant(
      user.organizationId,
      id,
      variantId,
    );
  }

  // --------------------------------------------------------------------------
  // Extras
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: 'Añadir extra al artículo' })
  @RequirePermissions('catalog:manage')
  @Post(':id/extras')
  createExtra(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CreateExtraDto,
  ) {
    return this.products.createExtra(user.organizationId, id, dto);
  }

  @ApiOperation({ summary: 'Editar extra y su consumo de inventario' })
  @RequirePermissions('catalog:manage')
  @Patch(':id/extras/:extraId')
  updateExtra(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('extraId') extraId: string,
    @Body() dto: UpdateExtraDto,
  ) {
    return this.products.updateExtra(user.organizationId, id, extraId, dto);
  }

  @ApiOperation({ summary: 'Desactivar extra' })
  @RequirePermissions('catalog:manage')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/extras/:extraId')
  deactivateExtra(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('extraId') extraId: string,
  ) {
    return this.products.deactivateExtra(user.organizationId, id, extraId);
  }

  // --------------------------------------------------------------------------
  // Exclusiones y combos
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: 'Reemplazar ingredientes que se pueden quitar' })
  @RequirePermissions('catalog:manage')
  @Put(':id/exclusions')
  replaceExclusions(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: ReplaceExclusionsDto,
  ) {
    return this.products.replaceExclusions(
      user.organizationId,
      id,
      dto.exclusions,
    );
  }

  @ApiOperation({ summary: 'Reemplazar componentes del combo' })
  @RequirePermissions('catalog:manage')
  @Put(':id/combo-components')
  replaceComboComponents(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: ReplaceComboComponentsDto,
  ) {
    return this.products.replaceComboComponents(
      user.organizationId,
      id,
      dto.components,
    );
  }
}

