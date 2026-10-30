import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { CatalogImportService } from './catalog-import.service';
import { IngredientQuantitiesService } from './ingredient-quantities.service';
import { UnitsController } from './units.controller';

@Module({
  controllers: [CategoriesController, ItemsController, RecipesController, UnitsController],
  providers: [
    CategoriesService,
    ItemsService,
    RecipesService,
    CatalogImportService,
    IngredientQuantitiesService,
  ],
})
export class CatalogModule {}
