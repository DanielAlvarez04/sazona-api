// Comprueba que las páginas /catalog, /catalog/[id] e /inventory renderizan
// con una sesión real. Uso: node smoke-web.cjs
const API = 'http://localhost:3001/v1';
const WEB = 'http://localhost:3000';
const ADMIN = { identifier: 'admin@naranjapimienta.local', password: 'Naranja123!' };

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
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(base, method, path, body) {
    const headers = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers.Origin = WEB;
    }
    if (this.cookies.size > 0) headers.Cookie = this.cookieHeader;

    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    this.store(res);
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }

  api(method, path, body) {
    return this.request(API, method, path, body);
  }

  web(path) {
    return this.request(WEB, 'GET', path);
  }
}

async function main() {
  console.log('\n[sin sesión]');
  const anonymous = await new Client().web('/catalog');
  check(
    'sin sesión /catalog redirige al login',
    anonymous.status === 307 || anonymous.status === 302,
    `${anonymous.status} ${anonymous.location ?? ''}`,
  );

  console.log('\n[login]');
  const admin = new Client();
  const login = await admin.api('POST', '/auth/login', ADMIN);
  check('login admin 200', login.status === 200, login.text.slice(0, 120));

  // Un ADMIN que aún no completó el onboarding debe verlo antes del panel.
  const adminMe = JSON.parse((await admin.api('GET', '/auth/me')).text);
  if (!adminMe.onboarded) {
    const pending = await admin.web('/dashboard');
    check(
      'un ADMIN pendiente va a /onboarding',
      (pending.status === 302 || pending.status === 307) &&
        (pending.location ?? '').includes('/onboarding'),
      `${pending.status} ${pending.location ?? ''}`,
    );

    const completion = await admin.api('POST', '/auth/onboarding/complete', {});
    check(
      'completa el onboarding pendiente del ADMIN',
      completion.status === 200,
      completion.text.slice(0, 120),
    );
  }

  console.log('\n[catálogo]');
  const products = await admin.api('GET', '/catalog/products?includeInactive=true');
  const list = JSON.parse(products.text);
  const latte = list.find((p) => p.sku === 'CAF-LAT');
  const combo = list.find((p) => p.sku === 'COM-DES');
  check('el seed sigue intacto', list.length === 6, String(list.length));

  const catalog = await admin.web('/catalog');
  check('/catalog responde 200', catalog.status === 200, String(catalog.status));
  check('muestra el título Catálogo', catalog.text.includes('Catálogo'));
  check('lista el Latte del seed', catalog.text.includes('Latte'));
  check('incluye el botón Nuevo producto', catalog.text.includes('Nuevo producto'));

  console.log('\n[detalle de producto]');
  const lattePage = await admin.web(`/catalog/${latte.id}`);
  check('detalle responde 200', lattePage.status === 200, String(lattePage.status));
  check('muestra los datos generales', lattePage.text.includes('Datos generales'));
  check('muestra la receta base', lattePage.text.includes('Receta base'));
  check(
    'muestra la receta de la variante Grande',
    lattePage.text.includes('Variante · Grande'),
    'no aparece la variante',
  );
  check('muestra los extras', lattePage.text.includes('Shot extra'));
  check(
    'no muestra el editor de combo en un producto normal',
    !lattePage.text.includes('Componentes del combo'),
  );

  const comboPage = await admin.web(`/catalog/${combo.id}`);
  check('el combo responde 200', comboPage.status === 200, String(comboPage.status));
  check(
    'el combo muestra sus componentes',
    comboPage.text.includes('Componentes del combo'),
  );

  const missing = await admin.web('/catalog/no-existe');
  check('producto inexistente → 404', missing.status === 404, String(missing.status));

  console.log('\n[inventario]');
  const inventory = await admin.web('/inventory');
  check('/inventory responde 200', inventory.status === 200, String(inventory.status));
  check('muestra el título Inventario', inventory.text.includes('Inventario'));
  check('muestra la tabla de ingredientes', inventory.text.includes('Ingredientes'));
  check('muestra el kardex', inventory.text.includes('Kardex de movimientos'));
  check('muestra el café del seed', inventory.text.includes('Café molido'));
  check('incluye el botón Nuevo ingrediente', inventory.text.includes('Nuevo ingrediente'));
  check('incluye filtros de estado', inventory.text.includes('Solo bajo mínimo'));

  console.log('\n[ajustes]');
  const settings = await admin.web('/settings');
  check('/settings responde 200', settings.status === 200, String(settings.status));
  check('muestra la tarjeta de cuenta', settings.text.includes('Cuenta'));
  check('muestra el acceso con Google', settings.text.includes('Acceso con Google'));
  check(
    'ofrece vincular Google o indica que ya está vinculado',
    settings.text.includes('Vincular Google') || settings.text.includes('Vinculado'),
  );

  const linked = await admin.web('/settings?google=linked');
  check(
    'confirma la vinculación de Google',
    linked.text.includes('quedó vinculada'),
  );

  const linkError = await admin.web('/settings?google=error_mismatch');
  check(
    'explica el error de vinculación',
    linkError.text.includes('ya está vinculada a otro usuario'),
  );

  console.log('\n[registro]');
  const registerPage = await new Client().web('/register');
  check('/register responde 200', registerPage.status === 200, String(registerPage.status));
  check(
    'pide el nombre del negocio',
    registerPage.text.includes('Nombre del negocio'),
  );
  check(
    'ofrece crear la cuenta con Google',
    registerPage.text.includes('Continuar con Google'),
  );

  console.log('\n[onboarding]');
  const newOwner = new Client();
  const onboardingId = Date.now();
  const signup = await newOwner.api('POST', '/auth/register', {
    organizationName: `Negocio ${onboardingId}`,
    name: 'Dueña Nueva',
    email: `onboarding+${onboardingId}@naranjapimienta.local`,
    password: 'Onboarding123!',
  });
  check('registro público 201', signup.status === 201, signup.text.slice(0, 120));

  const onboarding = await newOwner.web('/onboarding');
  check(
    '/onboarding responde 200 para una cuenta nueva',
    onboarding.status === 200,
    String(onboarding.status),
  );
  check(
    'pide el nombre del negocio',
    onboarding.text.includes('¿Cómo se llama tu negocio?'),
  );
  check(
    'pide el dominio de los usuarios',
    onboarding.text.includes('Dominio') && onboarding.text.includes('nombre@dominio'),
  );
  check(
    'muestra los tres pasos',
    onboarding.text.includes('Tu cuenta') && onboarding.text.includes('Bienvenida'),
  );

  const beforeComplete = await newOwner.web('/dashboard');
  check(
    'el panel redirige al onboarding',
    (beforeComplete.status === 302 || beforeComplete.status === 307) &&
      (beforeComplete.location ?? '').includes('/onboarding'),
    `${beforeComplete.status} ${beforeComplete.location ?? ''}`,
  );

  const completed = await newOwner.api('POST', '/auth/onboarding/complete', {});
  check(
    'completa el onboarding desde la API',
    completed.status === 200,
    completed.text.slice(0, 120),
  );

  const afterComplete = await newOwner.web('/onboarding');
  check(
    '/onboarding redirige al panel una vez completo',
    (afterComplete.status === 302 || afterComplete.status === 307) &&
      (afterComplete.location ?? '').includes('/dashboard'),
    `${afterComplete.status} ${afterComplete.location ?? ''}`,
  );

  const newDashboard = await newOwner.web('/dashboard');
  check(
    '/dashboard responde 200 tras el onboarding',
    newDashboard.status === 200,
    String(newDashboard.status),
  );

  console.log('\n[usuarios]');
  const users = await admin.web('/users');
  check('/users responde 200', users.status === 200, String(users.status));
  check('incluye el botón Nuevo usuario', users.text.includes('Nuevo usuario'));
  check(
    'explica que son cuentas internas',
    users.text.includes('Cuentas internas'),
  );
  check('lista al administrador del seed', users.text.includes('admin@naranjapimienta.local'));

  console.log(
    `\n${total} comprobaciones · ${total - failures} PASS · ${failures} FAIL`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exitCode = 1;
});
