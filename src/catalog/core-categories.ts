import { CategoryKind } from '@prisma/client';

export interface CoreCategory {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  kind: CategoryKind;
}

/**
 * Categorías core de artículos del catálogo.
 *
 * Son globales (`organizationId = null`), no editables y se identifican por
 * `code` para que la app pueda referenciarlas sin depender del nombre.
 */
export const CORE_ARTICLE_CATEGORIES: CoreCategory[] = [
  { code: 'breakfast', name: 'Desayunos', description: 'Platillos y paquetes de desayuno', sortOrder: 1, kind: CategoryKind.ARTICLE },
  { code: 'starters', name: 'Entradas y botanas', description: 'Entradas, botanas y aperitivos', sortOrder: 2, kind: CategoryKind.ARTICLE },
  { code: 'main_dishes', name: 'Platillos y comidas', description: 'Platillos principales y comidas corridas', sortOrder: 3, kind: CategoryKind.ARTICLE },
  { code: 'tacos', name: 'Tacos y antojitos', description: 'Tacos, quesadillas y antojitos mexicanos', sortOrder: 4, kind: CategoryKind.ARTICLE },
  { code: 'burgers_sandwiches', name: 'Hamburguesas y sándwiches', description: 'Hamburguesas, sándwiches y baguettes', sortOrder: 5, kind: CategoryKind.ARTICLE },
  { code: 'pizza_pasta', name: 'Pizzas y pastas', description: 'Pizzas, pastas y platillos italianos', sortOrder: 6, kind: CategoryKind.ARTICLE },
  { code: 'bakery', name: 'Panadería', description: 'Pan dulce, pan salado y repostería de vitrina', sortOrder: 7, kind: CategoryKind.ARTICLE },
  { code: 'desserts', name: 'Postres', description: 'Postres y dulces', sortOrder: 8, kind: CategoryKind.ARTICLE },
  { code: 'cakes', name: 'Pasteles y repostería', description: 'Pasteles, tartas y repostería fina', sortOrder: 9, kind: CategoryKind.ARTICLE },
  { code: 'ice_cream', name: 'Helados y postres fríos', description: 'Helados, nieves y postres fríos', sortOrder: 10, kind: CategoryKind.ARTICLE },
  { code: 'hot_drinks', name: 'Bebidas calientes', description: 'Café, té, chocolate y bebidas calientes', sortOrder: 11, kind: CategoryKind.ARTICLE },
  { code: 'cold_drinks', name: 'Bebidas frías', description: 'Café frío, frappés, jugos y aguas frescas', sortOrder: 12, kind: CategoryKind.ARTICLE },
  { code: 'bottled_drinks', name: 'Bebidas embotelladas', description: 'Refrescos, aguas y bebidas envasadas', sortOrder: 13, kind: CategoryKind.ARTICLE },
  { code: 'alcohol', name: 'Bebidas alcohólicas', description: 'Cervezas, vinos y licores', sortOrder: 14, kind: CategoryKind.ARTICLE },
  { code: 'cocktails', name: 'Coctelería', description: 'Cócteles y bebidas preparadas con alcohol', sortOrder: 15, kind: CategoryKind.ARTICLE },
  { code: 'sides', name: 'Guarniciones y complementos', description: 'Guarniciones y acompañamientos', sortOrder: 16, kind: CategoryKind.ARTICLE },
  { code: 'extras', name: 'Extras y adicionales', description: 'Extras y adicionales para los platillos', sortOrder: 17, kind: CategoryKind.ARTICLE },
  { code: 'combos', name: 'Paquetes y combos', description: 'Paquetes, combos y promociones', sortOrder: 18, kind: CategoryKind.ARTICLE },
  { code: 'retail', name: 'Productos empacados', description: 'Productos empacados para llevar', sortOrder: 19, kind: CategoryKind.ARTICLE },
  { code: 'custom_orders', name: 'Pedidos especiales', description: 'Pedidos personalizados y por encargo', sortOrder: 20, kind: CategoryKind.ARTICLE },
];

/** Categorías core de recetas y preparaciones. */
export const CORE_RECIPE_CATEGORIES: CoreCategory[] = [
  { code: 'dishes', name: 'Platillos', description: 'Preparaciones de platillos completos', sortOrder: 1, kind: CategoryKind.RECIPE },
  { code: 'sauces', name: 'Salsas y aderezos', description: 'Salsas, aderezos y dips', sortOrder: 2, kind: CategoryKind.RECIPE },
  { code: 'doughs', name: 'Masas y pastas', description: 'Masas, pastas y bases', sortOrder: 3, kind: CategoryKind.RECIPE },
  { code: 'batters', name: 'Batidos y mezclas', description: 'Batidos, mezclas y rebozados', sortOrder: 4, kind: CategoryKind.RECIPE },
  { code: 'fillings', name: 'Rellenos y coberturas', description: 'Rellenos, coberturas y glaseados', sortOrder: 5, kind: CategoryKind.RECIPE },
  { code: 'syrups', name: 'Jarabes y concentrados', description: 'Jarabes, concentrados y bases líquidas', sortOrder: 6, kind: CategoryKind.RECIPE },
  { code: 'beverages', name: 'Preparaciones de bebidas', description: 'Preparaciones base para bebidas', sortOrder: 7, kind: CategoryKind.RECIPE },
  { code: 'sides', name: 'Guarniciones y acompañamientos', description: 'Guarniciones y acompañamientos preparados', sortOrder: 8, kind: CategoryKind.RECIPE },
  { code: 'prepped_ingredients', name: 'Insumos preelaborados', description: 'Insumos listos para usar en otras recetas', sortOrder: 9, kind: CategoryKind.RECIPE },
  { code: 'portioned_items', name: 'Productos porcionados', description: 'Porciones preparadas y empaquetadas', sortOrder: 10, kind: CategoryKind.RECIPE },
  { code: 'other', name: 'Otras preparaciones', description: 'Otras preparaciones que no encajan en el resto', sortOrder: 11, kind: CategoryKind.RECIPE },
];

export const CORE_CATEGORIES: CoreCategory[] = [
  ...CORE_ARTICLE_CATEGORIES,
  ...CORE_RECIPE_CATEGORIES,
];
