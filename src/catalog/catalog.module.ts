import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { CatalogImportService } from './catalog-import.service';
import { IngredientQuantitiesService } from './ingredient-quantities.service';
import { UnitsController } from './units.controller';

@Module({
  controllers: [CategoriesController, ProductsController, RecipesController, UnitsController],
  providers: [
    CategoriesService,
    ProductsService,
    RecipesService,
    CatalogImportService,
    IngredientQuantitiesService,
  ],
})
export class CatalogModule {}
