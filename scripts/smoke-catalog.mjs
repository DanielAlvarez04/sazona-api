// Prueba de humo del catálogo, recetas e inventario contra una API en ejecución.
// Uso: node scripts/smoke-catalog.mjs [--keep]
// Requiere: API en http://localhost:3001/v1, base de datos migrada y seed aplicado.
//
// Los datos que crea llevan un sufijo único y se borran al final con Prisma para
// no ensuciar el catálogo de desarrollo (--keep los conserva).
//
// El login está limitado a 5 intentos por minuto e IP; el script reintenta una
// vez tras esperar si la API responde 429.
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config();

const API_URL = process.env.API_URL ?? 'http://localhost:3001/v1';
const WEB_ORIGIN = 'http://localhost:3000';
const ADMIN = { identifier: 'admin@naranjapimienta.local', password: 'Naranja123!' };
const RUN = Date.now().toString(36);
const PREFIX = `QA-${RUN}`;

let failures = 0;
let total = 0;

function check(name, condition, detail = '') {
  total += 1;

  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` → ${detail}` : ''}`);
  }
}

class Client {
  cookies = new Map();

  store(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);

      if (value === '') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  get cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(method, path, body) {
    const headers = { Origin: WEB_ORIGIN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size > 0) headers.Cookie = this.cookieHeader;

    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    this.store(response);

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return { status: response.status, body: parsed };
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body) {
    return this.request('POST', path, body);
  }

  patch(path, body) {
    return this.request('PATCH', path, body);
  }

  put(path, body) {
    return this.request('PUT', path, body);
  }

  delete(path) {
    return this.request('DELETE', path);
  }
}

// IDs de lo creado, para poder borrarlo al terminar.
const created = { products: [], ingredients: [] };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * El login está limitado a 5 intentos/min por IP. Si una ejecución anterior
 * consumió la cuota, se espera y se reintenta una sola vez.
 */
async function loginWithRetry(client, credentials, label) {
  let result = await client.post('/auth/login', credentials);

  if (result.status === 429) {
    console.log(`  ... ${label}: límite de intentos, esperando 61 s`);
    await sleep(61_000);
    result = await client.post('/auth/login', credentials);
  }

  return result;
}

async function cleanup() {
  if (!process.env.DATABASE_URL) {
    console.log('\n[limpieza] DATABASE_URL no definida: se omite');
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Referencias Restrict: los componentes del combo deben soltarse antes de
    // borrar los productos.
    await prisma.comboComponent.deleteMany({
      where: {
        OR: [
          { comboId: { in: created.products } },
          { componentProductId: { in: created.products } },
        ],
      },
    });
    await prisma.recipe.deleteMany({
      where: { productId: { in: created.products } },
    });
    await prisma.product.deleteMany({ where: { id: { in: created.products } } });
    await prisma.category.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.inventoryMovement.deleteMany({
      where: { ingredientId: { in: created.ingredients } },
    });
    await prisma.ingredientEquivalence.deleteMany({
      where: { ingredientId: { in: created.ingredients } },
    });
    await prisma.ingredient.deleteMany({
      where: { id: { in: created.ingredients } },
    });
    console.log('\n[limpieza] datos de la prueba eliminados');
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const admin = new Client();

  console.log('\n[health y rutas protegidas]');
  const health = await admin.get('/health');
  check('health responde ok', health.status === 200 && health.body?.status === 'ok');

  for (const path of [
    '/catalog/products',
    '/catalog/units',
    '/inventory/ingredients',
    '/inventory/alerts',
  ]) {
    const anonymous = await new Client().get(path);
    check(`${path} sin sesión → 401`, anonymous.status === 401, String(anonymous.status));
  }

  console.log('\n[login admin]');
  const login = await loginWithRetry(admin, ADMIN, 'login admin');
  check('login admin 200', login.status === 200, JSON.stringify(login.body));
  console.log('\n[unidades]');
  const units = await admin.get('/catalog/units');
  check(
    '5 unidades soportadas',
    Array.isArray(units.body) && units.body.length === 5,
    JSON.stringify(units.body),
  );
  check(
    'kg y g comparten dimensión MASS',
    units.body?.find((u) => u.code === 'KG')?.dimension === 'MASS' &&
      units.body?.find((u) => u.code === 'G')?.dimension === 'MASS',
  );

  console.log('\n[catálogo sembrado]');
  const products = await admin.get('/catalog/products');
  check('seed: 6 productos visibles', products.body?.length === 6, String(products.body?.length));

  const latte = products.body?.find((p) => p.sku === 'CAF-LAT');
  const latteDetail = await admin.get(`/catalog/products/${latte?.id}`);
  check(
    'Latte tiene 2 variantes',
    latteDetail.body?.variants?.length === 2,
    String(latteDetail.body?.variants?.length),
  );
  const shotExtra = latteDetail.body?.extras?.find((e) => e.name === 'Shot extra');
  check(
    'el extra consume café en la unidad base (KG)',
    shotExtra?.ingredients?.[0]?.quantity === '0.008' &&
      shotExtra?.ingredients?.[0]?.ingredient?.baseUnit === 'KG',
    JSON.stringify(shotExtra?.ingredients),
  );
  check(
    'Latte permite quitar la leche',
    latteDetail.body?.ingredientExclusions?.some(
      (exclusion) => exclusion.ingredient?.name === 'Leche entera',
    ),
  );
  check(
    'Latte tiene receta base y receta de la variante Grande',
    latteDetail.body?.recipes?.length === 2 &&
      latteDetail.body.recipes.filter((recipe) => recipe.variant === null).length === 1,
  );

  const comboSeed = products.body?.find((p) => p.sku === 'COM-DES');
  const comboDetail = await admin.get(`/catalog/products/${comboSeed?.id}`);
  check(
    'el combo del seed tiene 2 componentes',
    comboDetail.body?.comboComponents?.length === 2,
    JSON.stringify(comboDetail.body?.comboComponents),
  );

  const categories = await admin.get('/catalog/categories');
  const categoryId = categories.body?.[0]?.id;
  check('hay al menos una categoría', Boolean(categoryId));

  // ---------------------------------------------------------------------------
  // Ingredientes y movimientos
  // ---------------------------------------------------------------------------

  console.log('\n[ingredientes]');
  const milk = await admin.post('/inventory/ingredients', {
    name: `${PREFIX} Leche`,
    baseUnit: 'ML',
    currentStock: 1000,
    minStock: 800,
  });
  check('crea ingrediente 201', milk.status === 201, JSON.stringify(milk.body));
  check('stock inicial 1000 ml', milk.body?.currentStock === '1000', milk.body?.currentStock);
  check('stock por encima del mínimo', milk.body?.isLowStock === false);
  const milkId = milk.body?.id;
  if (milkId) created.ingredients.push(milkId);

  const duplicateIngredientName = await admin.post('/inventory/ingredients', {
    name: `${PREFIX} Leche`,
    baseUnit: 'ML',
  });
  check('nombre duplicado → 409', duplicateIngredientName.status === 409, String(duplicateIngredientName.status));

  const initialMovements = await admin.get(`/inventory/movements?ingredientId=${milkId}`);
  check(
    'el stock inicial deja un movimiento auditable',
    initialMovements.body?.length === 1 &&
      initialMovements.body[0].type === 'ADJUSTMENT' &&
      initialMovements.body[0].stockAfter === '1000',
    JSON.stringify(initialMovements.body),
  );

  console.log('\n[ajustes de inventario]');
  const increase = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '250.5',
    reason: 'Entrada de prueba',
  });
  check('ajuste positivo 201', increase.status === 201, JSON.stringify(increase.body));
  check('stockAfter 1250.5', increase.body?.stockAfter === '1250.5', increase.body?.stockAfter);

  const inLiters = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '1',
    unit: 'L',
    reason: 'Entrada en litros',
  });
  check(
    '1 L se convierte a 1000 ml',
    inLiters.status === 201 && inLiters.body?.stockAfter === '2250.5',
    JSON.stringify(inLiters.body),
  );

  const negative = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '-99999',
    reason: 'Salida imposible',
  });
  check('ajuste que dejaría stock negativo → 400', negative.status === 400, String(negative.status));

  const zero = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '0',
    reason: 'Ajuste nulo',
  });
  check('ajuste en cero → 400', zero.status === 400, String(zero.status));

  const missingReason = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '-1',
  });
  check('ajuste sin motivo → 400', missingReason.status === 400, String(missingReason.status));

  const decrease = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '-2000',
    reason: 'Merma de prueba',
  });
  check('ajuste negativo 201', decrease.status === 201, JSON.stringify(decrease.body));
  check('stockAfter 250.5', decrease.body?.stockAfter === '250.5', decrease.body?.stockAfter);

  const dedupeKey = `smoke-${RUN}-dedupe`;
  const dedupeFirst = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '10',
    reason: 'Ajuste idempotente',
    dedupeKey,
  });
  const dedupeSecond = await admin.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '10',
    reason: 'Ajuste idempotente',
    dedupeKey,
  });
  check(
    'dedupeKey devuelve el mismo movimiento',
    dedupeFirst.body?.id === dedupeSecond.body?.id &&
      dedupeSecond.body?.duplicated === true,
    JSON.stringify(dedupeSecond.body),
  );
  check(
    'el ajuste duplicado no vuelve a mover el stock',
    dedupeSecond.body?.stockAfter === '260.5',
    dedupeSecond.body?.stockAfter,
  );

  console.log('\n[alertas de stock]');
  const alerts = await admin.get('/inventory/alerts');
  check(
    'la leche de prueba aparece en alertas',
    alerts.body?.some((alert) => alert.id === milkId),
  );
  const lowStockList = await admin.get('/inventory/ingredients?lowStockOnly=true');
  check(
    'lowStockOnly incluye solo ingredientes bajo mínimo',
    Array.isArray(lowStockList.body) &&
      lowStockList.body.every((ingredient) => ingredient.isLowStock === true) &&
      lowStockList.body.some((ingredient) => ingredient.id === milkId),
  );

  const lowerMin = await admin.patch(`/inventory/ingredients/${milkId}`, { minStock: 100 });
  check('actualiza el stock mínimo', lowerMin.status === 200, JSON.stringify(lowerMin.body));
  check('con mínimo 100 ya no está bajo stock', lowerMin.body?.isLowStock === false);
  const alertsAfter = await admin.get('/inventory/alerts');
  check(
    'sale de alertas al bajar el mínimo',
    !alertsAfter.body?.some((alert) => alert.id === milkId),
  );

  const unitChange = await admin.patch(`/inventory/ingredients/${milkId}`, { baseUnit: 'L' });
  check(
    'no se puede cambiar la unidad base con movimientos → 409',
    unitChange.status === 409,
    String(unitChange.status),
  );

  // ---------------------------------------------------------------------------
  // Equivalencias entre dimensiones
  // ---------------------------------------------------------------------------

  console.log('\n[equivalencias]');
  const flour = await admin.post('/inventory/ingredients', {
    name: `${PREFIX} Harina`,
    baseUnit: 'G',
    currentStock: 500,
    minStock: 100,
  });
  const flourId = flour.body?.id;
  if (flourId) created.ingredients.push(flourId);

  const sameDimension = await admin.post(`/inventory/ingredients/${flourId}/equivalences`, {
    fromUnit: 'KG',
    toUnit: 'G',
    factor: 1000,
  });
  check(
    'equivalencia masa→masa → 400 (ya es fija)',
    sameDimension.status === 400,
    String(sameDimension.status),
  );

  const equivalence = await admin.post(`/inventory/ingredients/${flourId}/equivalences`, {
    fromUnit: 'ML',
    toUnit: 'G',
    factor: 1,
    note: '1 ml de harina = 1 g (prueba)',
  });
  check('crea equivalencia 201', equivalence.status === 201, JSON.stringify(equivalence.body));

  const duplicateEquivalence = await admin.post(
    `/inventory/ingredients/${flourId}/equivalences`,
    { fromUnit: 'ML', toUnit: 'G', factor: 2 },
  );
  check(
    'equivalencia duplicada → 409',
    duplicateEquivalence.status === 409,
    String(duplicateEquivalence.status),
  );

  // ---------------------------------------------------------------------------
  // Productos
  // ---------------------------------------------------------------------------

  console.log('\n[productos]');
  const product = await admin.post('/catalog/products', {
    name: `${PREFIX} Bebida`,
    sku: `${PREFIX}-BEB`,
    description: 'Producto de prueba',
    categoryId,
    price: 55,
    taxRate: 0.16,
    variants: [
      { name: 'Chico', priceAdjust: 0, sortOrder: 1 },
      { name: 'Grande', priceAdjust: 5, sortOrder: 2 },
    ],
    extras: [
      {
        name: 'Extra harina',
        price: 10,
        ingredients: [{ ingredientId: flourId, quantity: 20 }],
      },
    ],
    exclusions: [{ ingredientId: flourId, label: 'Sin harina' }],
  });
  check('crea producto con variantes, extras y exclusiones 201', product.status === 201, JSON.stringify(product.body));
  const productId = product.body?.id;
  if (productId) created.products.push(productId);

  check('detalle: 2 variantes', product.body?.variants?.length === 2);
  check('detalle: 1 extra con consumo', product.body?.extras?.[0]?.ingredients?.length === 1);
  check('detalle: 1 exclusión', product.body?.ingredientExclusions?.length === 1);
  const chico = product.body?.variants?.find((v) => v.name === 'Chico');
  const grande = product.body?.variants?.find((v) => v.name === 'Grande');

  const duplicateSku = await admin.post('/catalog/products', {
    name: `${PREFIX} Duplicado`,
    sku: `${PREFIX}-BEB`.toLowerCase(),
    price: 10,
  });
  check('SKU duplicado (sin distinguir mayúsculas) → 409', duplicateSku.status === 409, String(duplicateSku.status));

  const negativePrice = await admin.post('/catalog/products', {
    name: `${PREFIX} Precio negativo`,
    price: -1,
  });
  check('precio negativo → 400', negativePrice.status === 400, String(negativePrice.status));

  const unknownCategory = await admin.post('/catalog/products', {
    name: `${PREFIX} Categoría inexistente`,
    categoryId: 'no-existe',
    price: 10,
  });
  check('categoría inexistente → 404', unknownCategory.status === 404, String(unknownCategory.status));

  console.log('\n[variantes]');
  const newVariant = await admin.post(`/catalog/products/${productId}/variants`, {
    name: 'Mediano',
    priceAdjust: 2.5,
    sortOrder: 3,
  });
  check('añade variante 201', newVariant.status === 201, JSON.stringify(newVariant.body));
  check('el detalle refleja 3 variantes', newVariant.body?.product?.variants?.length === 3);

  const duplicateVariant = await admin.post(`/catalog/products/${productId}/variants`, {
    name: 'chico',
    priceAdjust: 0,
  });
  check('variante duplicada → 409', duplicateVariant.status === 409, String(duplicateVariant.status));

  const updatedVariant = await admin.patch(
    `/catalog/products/${productId}/variants/${chico?.id}`,
    { priceAdjust: 1 },
  );
  check('edita la variante', updatedVariant.body?.variant?.priceAdjust === '1', updatedVariant.body?.variant?.priceAdjust);

  const deactivatedVariant = await admin.delete(
    `/catalog/products/${productId}/variants/${newVariant.body?.variant?.id}`,
  );
  check('desactiva la variante', deactivatedVariant.status === 200, String(deactivatedVariant.status));

  // ---------------------------------------------------------------------------
  // Recetas
  // ---------------------------------------------------------------------------

  console.log('\n[recetas]');
  const baseRecipe = await admin.put(`/catalog/products/${productId}/recipes`, {
    ingredients: [{ ingredientId: flourId, quantity: 50, unit: 'ML' }],
  });
  check('crea receta base 200', baseRecipe.status === 200, JSON.stringify(baseRecipe.body));
  check(
    '50 ml se guardan como 50 g (unidad base)',
    baseRecipe.body?.ingredients?.[0]?.quantity === '50',
    baseRecipe.body?.ingredients?.[0]?.quantity,
  );
  check('la receta base no tiene variante', baseRecipe.body?.variant === null);

  const variantRecipe = await admin.put(`/catalog/products/${productId}/recipes`, {
    variantId: grande?.id,
    ingredients: [
      { ingredientId: flourId, quantity: 70 },
      { ingredientId: milkId, quantity: 0.2, unit: 'L' },
    ],
  });
  check('crea receta de la variante 200', variantRecipe.status === 200, JSON.stringify(variantRecipe.body));
  check(
    '0.2 L se guardan como 200 ml',
    variantRecipe.body?.ingredients?.find((i) => i.ingredient.id === milkId)?.quantity === '200',
  );
  check(
    'nombre por defecto con la variante',
    variantRecipe.body?.name?.endsWith('— Grande'),
    variantRecipe.body?.name,
  );

  const recipeList = await admin.get(`/catalog/products/${productId}/recipes`);
  check('lista 2 recetas', recipeList.body?.length === 2, String(recipeList.body?.length));
  check(
    'recetas con ingredientes pueden calcular consumo',
    recipeList.body?.every((recipe) => recipe.canComputeConsumption === true),
  );

  const replacedRecipe = await admin.put(`/catalog/products/${productId}/recipes`, {
    ingredients: [
      { ingredientId: flourId, quantity: 60 },
      { ingredientId: milkId, quantity: 100 },
    ],
  });
  check('reemplaza la receta base sin duplicarla', replacedRecipe.body?.ingredients?.length === 2);
  const afterReplace = await admin.get(`/catalog/products/${productId}/recipes`);
  check('sigue habiendo 2 recetas', afterReplace.body?.length === 2, String(afterReplace.body?.length));

  const duplicateIngredient = await admin.put(`/catalog/products/${productId}/recipes`, {
    ingredients: [
      { ingredientId: flourId, quantity: 10 },
      { ingredientId: flourId, quantity: 20 },
    ],
  });
  check('ingrediente repetido en la receta → 400', duplicateIngredient.status === 400, String(duplicateIngredient.status));

  const foreignVariantRecipe = await admin.put(`/catalog/products/${productId}/recipes`, {
    variantId: latte?.variants?.[0]?.id ?? 'no-existe',
    ingredients: [{ ingredientId: flourId, quantity: 10 }],
  });
  check(
    'variante de otro producto en la receta → 404',
    foreignVariantRecipe.status === 404,
    String(foreignVariantRecipe.status),
  );

  const emptyRecipe = await admin.put(`/catalog/products/${productId}/recipes`, {
    ingredients: [],
  });
  check('receta sin ingredientes → 400', emptyRecipe.status === 400, String(emptyRecipe.status));

  console.log('\n[exclusiones]');
  const replacedExclusions = await admin.put(`/catalog/products/${productId}/exclusions`, {
    exclusions: [
      { ingredientId: flourId, label: 'Sin harina' },
      { ingredientId: milkId },
    ],
  });
  check('reemplaza exclusiones', replacedExclusions.body?.ingredientExclusions?.length === 2);

  // ---------------------------------------------------------------------------
  // Combos
  // ---------------------------------------------------------------------------

  console.log('\n[combos]');
  const combo = await admin.post('/catalog/products', {
    name: `${PREFIX} Combo`,
    sku: `${PREFIX}-COM`,
    categoryId,
    price: 70,
    isCombo: true,
    comboComponents: [{ productId, variantId: chico?.id, quantity: 1 }],
  });
  check('crea combo 201', combo.status === 201, JSON.stringify(combo.body));
  const comboId = combo.body?.id;
  if (comboId) created.products.push(comboId);
  check('el combo tiene 1 componente', combo.body?.comboComponents?.length === 1);

  const nestedCombo = await admin.post('/catalog/products', {
    name: `${PREFIX} Combo anidado`,
    price: 90,
    isCombo: true,
    comboComponents: [{ productId: comboId, quantity: 1 }],
  });
  check('combo dentro de combo → 400', nestedCombo.status === 400, String(nestedCombo.status));

  const emptyCombo = await admin.post('/catalog/products', {
    name: `${PREFIX} Combo vacío`,
    price: 10,
    isCombo: true,
  });
  check('combo sin componentes → 400', emptyCombo.status === 400, String(emptyCombo.status));

  const componentsWithoutCombo = await admin.post('/catalog/products', {
    name: `${PREFIX} No combo con componentes`,
    price: 10,
    comboComponents: [{ productId, quantity: 1 }],
  });
  check('componentes sin isCombo → 400', componentsWithoutCombo.status === 400, String(componentsWithoutCombo.status));

  const replacedComponents = await admin.put(`/catalog/products/${comboId}/combo-components`, {
    components: [
      { productId, variantId: grande?.id, quantity: 2 },
      { productId: latte.id, variantId: latte.variants[0].id, quantity: 1 },
    ],
  });
  check('reemplaza los componentes del combo', replacedComponents.body?.comboComponents?.length === 2);

  const emptyReplace = await admin.put(`/catalog/products/${comboId}/combo-components`, {
    components: [],
  });
  check(
    'dejar el combo sin componentes → 400',
    emptyReplace.status === 400,
    String(emptyReplace.status),
  );

  const deactivateComponent = await admin.delete(`/catalog/products/${productId}`);
  check(
    'no se puede desactivar un producto usado en un combo activo → 409',
    deactivateComponent.status === 409,
    String(deactivateComponent.status),
  );

  const seedOnlyComponents = await admin.put(`/catalog/products/${comboId}/combo-components`, {
    components: [{ productId: latte.id, variantId: latte.variants[0].id, quantity: 1 }],
  });
  check(
    'el combo puede quedarse solo con productos del seed',
    seedOnlyComponents.body?.comboComponents?.length === 1,
  );

  // ---------------------------------------------------------------------------
  // Importación CSV
  // ---------------------------------------------------------------------------

  console.log('\n[importación CSV]');
  const csvName = `${PREFIX} CSV "especial", con coma`;
  const quotedName = `"${csvName.replace(/"/g, '""')}"`;
  const csv = [
    'sku,name,category,description,price,taxRate,isActive',
    `${PREFIX}-CSV-1,${quotedName},${PREFIX} Categoría,Desde CSV,12.50,0.16,true`,
    `${PREFIX}-CSV-2,${PREFIX} CSV inválido,,Precio roto,abc,,`,
    `${PREFIX}-CSV-3,${PREFIX} CSV negativo,,Negativo,-3,,`,
  ].join('\n');

  const dryRun = await admin.post('/catalog/products/import', { csv, dryRun: true });
  check('dry-run responde 200', dryRun.status === 200, JSON.stringify(dryRun.body));
  check('dry-run: 1 creado', dryRun.body?.created === 1, String(dryRun.body?.created));
  check('dry-run: 2 con error', dryRun.body?.errors?.length === 2, JSON.stringify(dryRun.body?.errors));
  check(
    'el error de precio señala la columna',
    dryRun.body?.errors?.some((error) => error.column === 'price' && error.row === 3),
    JSON.stringify(dryRun.body?.errors),
  );
  const dryRunCheck = await admin.get(`/catalog/products?search=${PREFIX}-CSV-1`);
  check('dry-run no escribe nada', dryRunCheck.body?.length === 0, String(dryRunCheck.body?.length));

  const applied = await admin.post('/catalog/products/import', { csv });
  check('importa de verdad', applied.body?.created === 1, JSON.stringify(applied.body));
  const importedList = await admin.get(`/catalog/products?search=${PREFIX}-CSV-1`);
  const imported = importedList.body?.[0];
  if (imported) created.products.push(imported.id);
  check('el nombre con coma y comillas se conserva', imported?.name === csvName, imported?.name);
  check('la categoría se crea automáticamente', Boolean(imported?.category?.id));
  check(
    'el precio se guarda con 2 decimales',
    Number(imported?.price) === 12.5,
    imported?.price,
  );

  const reimport = await admin.post('/catalog/products/import', { csv });
  check('reimportar actualiza en vez de duplicar', reimport.body?.updated === 1 && reimport.body?.created === 0, JSON.stringify(reimport.body));
  const afterReimport = await admin.get(`/catalog/products?search=${PREFIX}-CSV-1`);
  check('sigue habiendo 1 producto con ese SKU', afterReimport.body?.length === 1);

  const unknownColumn = await admin.post('/catalog/products/import', {
    csv: 'name,price,color\nProducto,10,rojo',
  });
  check('columna desconocida → 400', unknownColumn.status === 400, String(unknownColumn.status));

  const missingColumn = await admin.post('/catalog/products/import', {
    csv: 'name\nProducto',
  });
  check('falta la columna price → 400', missingColumn.status === 400, String(missingColumn.status));

  // ---------------------------------------------------------------------------
  // Permisos
  // ---------------------------------------------------------------------------

  console.log('\n[permisos de mesero]');
  const waiterUsername = `mesero.catalogo.${RUN}`;
  const waiterEmail = `mesero-catalogo+${RUN}@naranjapimienta.local`;
  const waiterUser = await admin.post('/users', {
    username: waiterUsername,
    email: waiterEmail,
    name: 'Mesero catálogo',
    password: 'Mesero123!',
    roles: ['WAITER'],
  });
  check('admin crea mesero 201', waiterUser.status === 201, JSON.stringify(waiterUser.body));

  const waiter = new Client();
  const waiterLogin = await loginWithRetry(
    waiter,
    { identifier: waiterUsername, password: 'Mesero123!' },
    'login mesero',
  );
  check('login mesero 200', waiterLogin.status === 200, JSON.stringify(waiterLogin.body));

  const waiterRead = await waiter.get('/catalog/products');
  check('mesero puede leer el catálogo', waiterRead.status === 200, String(waiterRead.status));
  const waiterInventory = await waiter.get('/inventory/ingredients');
  check('mesero puede leer el inventario', waiterInventory.status === 200, String(waiterInventory.status));
  const waiterWriteProduct = await waiter.post('/catalog/products', {
    name: `${PREFIX} Prohibido`,
    price: 1,
  });
  check('mesero no puede crear productos → 403', waiterWriteProduct.status === 403, String(waiterWriteProduct.status));
  const waiterWriteStock = await waiter.post('/inventory/movements', {
    ingredientId: milkId,
    quantity: '1',
    reason: 'Intento de mesero',
  });
  check('mesero no puede ajustar stock → 403', waiterWriteStock.status === 403, String(waiterWriteStock.status));
  const waiterImport = await waiter.post('/catalog/products/import', {
    csv: 'name,price\nX,1',
  });
  check('mesero no puede importar CSV → 403', waiterImport.status === 403, String(waiterImport.status));

  const deactivatedWaiter = await admin.delete(`/users/${waiterUser.body?.id}`);
  check('admin desactiva al mesero', deactivatedWaiter.status === 200, String(deactivatedWaiter.status));

  const deletedProduct = await admin.delete(`/catalog/products/${productId}`);
  check(
    'desactiva el producto tras quitarlo del combo',
    deletedProduct.status === 200,
    String(deletedProduct.status),
  );
  const activeSearch = await admin.get(`/catalog/products?search=${PREFIX}-BEB`);
  check('el producto desactivado no aparece en el catálogo', activeSearch.body?.length === 0);
  const allSearch = await admin.get(
    `/catalog/products?includeInactive=true&search=${PREFIX}-BEB`,
  );
  check(
    'aparece con includeInactive y marca isActive=false',
    allSearch.body?.length === 1 && allSearch.body[0].isActive === false,
    JSON.stringify(allSearch.body),
  );
}

const shouldCleanup = process.argv.includes('--keep') === false;

main()
  .then(async () => {
    if (shouldCleanup) {
      await cleanup().catch((error) => {
        console.error('\n[limpieza] falló:', error.message);
      });
    }
    console.log(
      `\n${total} comprobaciones · ${total - failures} PASS · ${failures} FAIL`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error('Error inesperado:', error);
    process.exitCode = 1;
  });
