// Seed de desarrollo: usuario de prueba y catálogo ficticio.
// Idempotente: puede ejecutarse varias veces sin duplicar datos.
// Uso: npm run prisma:seed
import { config } from 'dotenv';
import { hash } from 'argon2';
import { PrismaClient, UnitCode } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config();

const TEST_EMAIL = 'admin@naranjapimienta.local';
const TEST_PASSWORD = 'Naranja123!';
const ORG_NAME = 'Naranja Pimienta';
const ORG_SLUG = 'naranja-pimienta';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está definida. Revisa api/.env');
  }

  // Mismo patrón que PrismaService (Prisma 7 con driver adapter)
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. Organización (el login exige una membresía activa)
    const org = await prisma.organization.upsert({
      where: { slug: ORG_SLUG },
      update: { name: ORG_NAME, isActive: true },
      create: { name: ORG_NAME, slug: ORG_SLUG },
    });

    // 2. Usuario — el hash se re-restablece en cada ejecución
    const passwordHash = await hash(TEST_PASSWORD);
    const user = await prisma.user.upsert({
      where: { email: TEST_EMAIL },
      update: { passwordHash, isActive: true },
      create: {
        email: TEST_EMAIL,
        passwordHash,
        name: 'Admin de prueba',
        isActive: true,
      },
    });

    // 3. Membresía ADMIN (sin ella el login responde "Usuario sin membresía activa")
    const membership = await prisma.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: org.id },
      },
      update: { roles: ['ADMIN'], isActive: true },
      create: { userId: user.id, organizationId: org.id, roles: ['ADMIN'] },
    });

    // ------------------------------------------------------------------------
    // Catálogo ficticio de la cafetería (no es el menú real)
    // ------------------------------------------------------------------------

    const categories = {
      calientes: await ensureCategory(prisma, org.id, 'Bebidas calientes', 1),
      frias: await ensureCategory(prisma, org.id, 'Bebidas frías', 2),
      panaderia: await ensureCategory(prisma, org.id, 'Panadería', 3),
      combos: await ensureCategory(prisma, org.id, 'Combos', 4),
    };

    const ingredients = {
      cafe: await ensureIngredient(prisma, org.id, {
        name: 'Café molido',
        baseUnit: UnitCode.KG,
        currentStock: '12',
        minStock: '2',
      }),
      leche: await ensureIngredient(prisma, org.id, {
        name: 'Leche entera',
        baseUnit: UnitCode.L,
        currentStock: '24',
        minStock: '5',
      }),
      agua: await ensureIngredient(prisma, org.id, {
        name: 'Agua filtrada',
        baseUnit: UnitCode.L,
        currentStock: '100',
        minStock: '10',
      }),
      harina: await ensureIngredient(prisma, org.id, {
        name: 'Harina de trigo',
        baseUnit: UnitCode.KG,
        currentStock: '25',
        minStock: '5',
      }),
      azucar: await ensureIngredient(prisma, org.id, {
        name: 'Azúcar',
        baseUnit: UnitCode.KG,
        currentStock: '15',
        minStock: '3',
      }),
      mantequilla: await ensureIngredient(prisma, org.id, {
        name: 'Mantequilla',
        baseUnit: UnitCode.KG,
        currentStock: '8',
        minStock: '2',
      }),
      chocolate: await ensureIngredient(prisma, org.id, {
        name: 'Chocolate en polvo',
        baseUnit: UnitCode.KG,
        currentStock: '6',
        minStock: '1.5',
      }),
      vaso: await ensureIngredient(prisma, org.id, {
        name: 'Vaso 12 oz',
        baseUnit: UnitCode.UNIT,
        currentStock: '400',
        minStock: '100',
      }),
      huevo: await ensureIngredient(prisma, org.id, {
        name: 'Huevo',
        baseUnit: UnitCode.UNIT,
        currentStock: '60',
        minStock: '12',
      }),
      matcha: await ensureIngredient(prisma, org.id, {
        name: 'Matcha en polvo',
        baseUnit: UnitCode.KG,
        currentStock: '1.2',
        minStock: '0.3',
      }),
    };

    // Equivalencia entre dimensiones: 1 g = 0.02 huevos (1 huevo ≈ 50 g).
    await prisma.ingredientEquivalence.upsert({
      where: {
        ingredientId_fromUnit_toUnit: {
          ingredientId: ingredients.huevo.id,
          fromUnit: UnitCode.G,
          toUnit: UnitCode.UNIT,
        },
      },
      update: { factor: '0.02', note: '1 huevo ≈ 50 g' },
      create: {
        ingredientId: ingredients.huevo.id,
        fromUnit: UnitCode.G,
        toUnit: UnitCode.UNIT,
        factor: '0.02',
        note: '1 huevo ≈ 50 g',
      },
    });

    const espresso = await ensureProduct(prisma, org.id, {
      sku: 'CAF-ESP',
      name: 'Espresso',
      description: 'Café solo de 30 ml',
      categoryId: categories.calientes.id,
      price: '35',
      taxRate: '0.16',
      sortOrder: 1,
    });

    const latte = await ensureProduct(prisma, org.id, {
      sku: 'CAF-LAT',
      name: 'Latte',
      description: 'Espresso con leche vaporizada',
      categoryId: categories.calientes.id,
      price: '55',
      taxRate: '0.16',
      sortOrder: 2,
      variants: [
        { name: 'Mediano', priceAdjust: '0', sortOrder: 1 },
        { name: 'Grande', priceAdjust: '10', sortOrder: 2 },
      ],
      extras: [
        {
          name: 'Shot extra',
          price: '12',
          ingredients: [{ ingredientId: ingredients.cafe.id, quantity: '0.008' }],
        },
      ],
      exclusions: [
        { ingredientId: ingredients.leche.id, label: 'Sin leche' },
      ],
    });

    const matchaLatte = await ensureProduct(prisma, org.id, {
      sku: 'CAF-MAT',
      name: 'Matcha latte',
      description: 'Matcha con leche',
      categoryId: categories.calientes.id,
      price: '65',
      taxRate: '0.16',
      sortOrder: 3,
      exclusions: [
        { ingredientId: ingredients.leche.id, label: 'Sin leche' },
      ],
    });

    const croissant = await ensureProduct(prisma, org.id, {
      sku: 'PAN-CRO',
      name: 'Croissant',
      description: 'Hojaldre de mantequilla',
      categoryId: categories.panaderia.id,
      price: '28',
      taxRate: '0.16',
      sortOrder: 1,
    });

    const chocolateCaliente = await ensureProduct(prisma, org.id, {
      sku: 'CAF-CHO',
      name: 'Chocolate caliente',
      description: 'Chocolate con leche',
      categoryId: categories.calientes.id,
      price: '48',
      taxRate: '0.16',
      sortOrder: 4,
    });

    const latteGrande = latte.variants.find(
      (variant) => variant.name === 'Grande',
    );

    const combo = await ensureProduct(prisma, org.id, {
      sku: 'COM-DES',
      name: 'Combo desayuno',
      description: 'Latte mediano + croissant',
      categoryId: categories.combos.id,
      price: '75',
      taxRate: '0.16',
      isCombo: true,
      sortOrder: 1,
      comboComponents: [
        {
          componentProductId: latte.id,
          componentVariantId: latte.variants.find((v) => v.name === 'Mediano')
            ?.id,
          quantity: 1,
        },
        { componentProductId: croissant.id, quantity: 1 },
      ],
    });

    await ensureRecipe(prisma, org.id, espresso.id, null, 'Espresso', [
      { ingredientId: ingredients.cafe.id, quantity: '0.008' },
      { ingredientId: ingredients.agua.id, quantity: '0.04' },
      { ingredientId: ingredients.vaso.id, quantity: '1' },
    ]);

    await ensureRecipe(prisma, org.id, latte.id, null, 'Latte — Mediano', [
      { ingredientId: ingredients.cafe.id, quantity: '0.008' },
      { ingredientId: ingredients.leche.id, quantity: '0.15' },
      { ingredientId: ingredients.vaso.id, quantity: '1' },
    ]);

    if (latteGrande) {
      await ensureRecipe(
        prisma,
        org.id,
        latte.id,
        latteGrande.id,
        'Latte — Grande',
        [
          { ingredientId: ingredients.cafe.id, quantity: '0.012' },
          { ingredientId: ingredients.leche.id, quantity: '0.22' },
          { ingredientId: ingredients.vaso.id, quantity: '1' },
        ],
      );
    }

    await ensureRecipe(
      prisma,
      org.id,
      matchaLatte.id,
      null,
      'Matcha latte',
      [
        { ingredientId: ingredients.matcha.id, quantity: '0.004' },
        { ingredientId: ingredients.leche.id, quantity: '0.2' },
        { ingredientId: ingredients.vaso.id, quantity: '1' },
      ],
    );

    await ensureRecipe(prisma, org.id, croissant.id, null, 'Croissant', [
      { ingredientId: ingredients.harina.id, quantity: '0.08' },
      { ingredientId: ingredients.mantequilla.id, quantity: '0.03' },
      { ingredientId: ingredients.azucar.id, quantity: '0.01' },
      { ingredientId: ingredients.huevo.id, quantity: '0.2' },
    ]);

    await ensureRecipe(
      prisma,
      org.id,
      chocolateCaliente.id,
      null,
      'Chocolate caliente',
      [
        { ingredientId: ingredients.chocolate.id, quantity: '0.03' },
        { ingredientId: ingredients.leche.id, quantity: '0.2' },
        { ingredientId: ingredients.azucar.id, quantity: '0.01' },
        { ingredientId: ingredients.vaso.id, quantity: '1' },
      ],
    );

    // El combo no tiene receta propia: su consumo sale de sus componentes.

    console.log('Seed completado:');
    console.log(`  Organización : ${org.name} (${org.id})`);
    console.log(`  Usuario      : ${user.email} (${user.id})`);
    console.log(`  Membresía    : ${membership.roles.join(', ')}`);
    console.log(`  Categorías   : ${Object.keys(categories).length}`);
    console.log(`  Ingredientes : ${Object.keys(ingredients).length}`);
    console.log(
      `  Productos    : ${[espresso, latte, matchaLatte, croissant, chocolateCaliente, combo]
        .map((product) => product.name)
        .join(', ')}`,
    );
    console.log(`  Credenciales : ${TEST_EMAIL} / ${TEST_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

type Prisma = PrismaClient;

async function ensureCategory(
  prisma: Prisma,
  organizationId: string,
  name: string,
  sortOrder: number,
) {
  return prisma.category.upsert({
    where: { organizationId_name: { organizationId, name } },
    update: { isActive: true },
    create: { organizationId, name, sortOrder },
  });
}

interface IngredientSeed {
  name: string;
  baseUnit: UnitCode;
  currentStock: string;
  minStock: string;
}

async function ensureIngredient(
  prisma: Prisma,
  organizationId: string,
  data: IngredientSeed,
) {
  return prisma.ingredient.upsert({
    where: {
      organizationId_name: { organizationId, name: data.name },
    },
    update: { isActive: true },
    create: {
      organizationId,
      name: data.name,
      baseUnit: data.baseUnit,
      currentStock: data.currentStock,
      minStock: data.minStock,
    },
  });
}

interface ProductSeed {
  sku: string;
  name: string;
  description?: string;
  categoryId?: string;
  price: string;
  taxRate?: string;
  isCombo?: boolean;
  sortOrder?: number;
  variants?: Array<{
    name: string;
    priceAdjust: string;
    sortOrder: number;
  }>;
  extras?: Array<{
    name: string;
    price: string;
    ingredients: Array<{ ingredientId: string; quantity: string }>;
  }>;
  exclusions?: Array<{ ingredientId: string; label?: string }>;
  comboComponents?: Array<{
    componentProductId: string;
    componentVariantId?: string;
    quantity: number;
  }>;
}

async function ensureProduct(
  prisma: Prisma,
  organizationId: string,
  data: ProductSeed,
) {
  const existing = await prisma.product.findUnique({
    where: { organizationId_sku: { organizationId, sku: data.sku } },
    include: { variants: true },
  });

  if (existing) {
    return existing;
  }

  return prisma.product.create({
    data: {
      organizationId,
      categoryId: data.categoryId,
      sku: data.sku,
      name: data.name,
      description: data.description,
      price: data.price,
      taxRate: data.taxRate,
      isCombo: data.isCombo ?? false,
      sortOrder: data.sortOrder ?? 0,
      variants: {
        create: data.variants ?? [],
      },
      extras: {
        create: (data.extras ?? []).map((extra) => ({
          name: extra.name,
          price: extra.price,
          ingredients: {
            create: extra.ingredients.map((ingredient) => ({
              quantity: ingredient.quantity,
              ingredient: { connect: { id: ingredient.ingredientId } },
            })),
          },
        })),
      },
      ingredientExclusions: {
        create: (data.exclusions ?? []).map((exclusion) => ({
          label: exclusion.label,
          ingredient: { connect: { id: exclusion.ingredientId } },
        })),
      },
      comboComponents: {
        create: (data.comboComponents ?? []).map((component) => ({
          quantity: component.quantity,
          component: { connect: { id: component.componentProductId } },
          ...(component.componentVariantId
            ? { variant: { connect: { id: component.componentVariantId } } }
            : {}),
        })),
      },
    },
    include: { variants: true },
  });
}

async function ensureRecipe(
  prisma: Prisma,
  organizationId: string,
  productId: string,
  variantId: string | null,
  name: string,
  ingredients: Array<{ ingredientId: string; quantity: string }>,
) {
  const existing = await prisma.recipe.findFirst({
    where: { productId, variantId },
  });

  if (existing) {
    return existing;
  }

  return prisma.recipe.create({
    data: {
      organizationId,
      productId,
      variantId,
      name,
      ingredients: {
        create: ingredients.map((ingredient) => ({
          ingredientId: ingredient.ingredientId,
          quantity: ingredient.quantity,
        })),
      },
    },
  });
}

main().catch((err) => {
  console.error('Seed falló:', err);
  process.exit(1);
});
