// Prueba de humo de los flujos de autenticación contra una API en ejecución.
// Uso: node scripts/smoke-auth.mjs
// Requiere: API en http://localhost:3001/v1, base de datos migrada y seed aplicado.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.API_URL ?? 'http://localhost:3001/v1';
const WEB_ORIGIN = 'http://localhost:3000';
const OUTBOX = join(dirname(fileURLToPath(import.meta.url)), '..', '.mail-outbox', 'mails.jsonl');
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

      // Un `Set-Cookie` vacío es un borrado (logout, reset de contraseña).
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

  async request(method, path, body, options = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size > 0) headers.Cookie = this.cookieHeader;
    if (options.origin !== false) headers.Origin = WEB_ORIGIN;

    const response = await fetch(`${BASE}${path}`, {
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

  post(path, body, options) {
    return this.request('POST', path, body, options);
  }

  patch(path, body) {
    return this.request('PATCH', path, body);
  }

  delete(path) {
    return this.request('DELETE', path);
  }
}

/**
 * Login con reintento: el flujo hace varias entradas seguidas y la API limita
 * los intentos por minuto (429). Esperamos la ventana y volvemos a probar.
 */
async function login(client, credentials, attempts = 2) {
  let result = await client.post('/auth/login', credentials);

  for (let attempt = 1; result.status === 429 && attempt < attempts; attempt += 1) {
    console.log('  ...  límite de intentos de login; esperando 65 s');
    await new Promise((resolve) => setTimeout(resolve, 65_000));
    result = await client.post('/auth/login', credentials);
  }

  return result;
}

async function lastMailTo(email, subjectIncludes) {
  const raw = await readFile(OUTBOX, 'utf8');
  const lines = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (mail) =>
        mail.to === email && mail.subject.includes(subjectIncludes),
    );

  return lines.at(-1);
}

function tokenFrom(text) {
  const match = text.match(/es\s+([A-Za-z0-9-]+\.[A-Za-z0-9]+)/);
  return match?.[1];
}

function codeFrom(text) {
  const match = text.match(/es\s+(\d{6})/);
  return match?.[1];
}

const unique = Date.now();

async function main() {
  const admin = new Client();

  console.log('\n[health]');
  const health = await admin.get('/health');
  check('health responde ok', health.status === 200 && health.body?.status === 'ok', JSON.stringify(health.body));

  console.log('\n[login admin]');
  const adminLogin = await login(admin, ADMIN);
  check('login admin 200', adminLogin.status === 200, JSON.stringify(adminLogin.body));
  check('login entrega usuario con rol ADMIN', adminLogin.body?.user?.roles?.includes('ADMIN'));

  console.log('\n[me y permisos]');
  const me = await admin.get('/auth/me');
  check('me con cookies 200', me.status === 200, JSON.stringify(me.body));
  check('me expone googleLinked', typeof me.body?.googleLinked === 'boolean');
  const permissions = await admin.get('/auth/permissions');
  check('admin tiene users:manage', permissions.body?.permissions?.includes('users:manage'));

  console.log('\n[CSRF]');
  const noOrigin = await admin.post('/auth/refresh', undefined, { origin: false });
  check('refresh con cookies sin Origin → 403', noOrigin.status === 403, String(noOrigin.status));
  const withOrigin = await admin.post('/auth/refresh');
  check('refresh con Origin → 200', withOrigin.status === 200, String(withOrigin.status));

  console.log('\n[Google OAuth]');
  const googleResponse = await fetch(`${BASE}/auth/google`, { redirect: 'manual' });
  const googleLocation = googleResponse.headers.get('location') ?? '';
  check(
    'google responde 503 (sin configurar) o redirige a Google',
    googleResponse.status === 503 ||
      (googleResponse.status >= 300 &&
        googleResponse.status < 400 &&
        googleLocation.startsWith('https://accounts.google.com/')),
    `${googleResponse.status} ${googleLocation}`,
  );

  const linkAnonymous = await fetch(`${BASE}/auth/google/link`, {
    redirect: 'manual',
  });
  check(
    'google/link sin sesión → 401',
    linkAnonymous.status === 401,
    String(linkAnonymous.status),
  );

  const linkResponse = await fetch(`${BASE}/auth/google/link`, {
    redirect: 'manual',
    headers: { Cookie: admin.cookieHeader, Origin: WEB_ORIGIN },
  });
  const linkLocation = linkResponse.headers.get('location') ?? '';
  const linkCookies = (linkResponse.headers.getSetCookie?.() ?? []).join('; ');
  check(
    'google/link con sesión → 503 o redirige a Google',
    linkResponse.status === 503 ||
      (linkResponse.status >= 300 &&
        linkResponse.status < 400 &&
        linkLocation.startsWith('https://accounts.google.com/')),
    `${linkResponse.status} ${linkLocation}`,
  );
  check(
    'google/link marca el flujo con cookie',
    linkResponse.status === 503 || linkCookies.includes('np_oauth_link=1'),
    linkCookies,
  );

  console.log('\n[registro público]');
  const owner = new Client();
  const businessName = `Café ${unique}`;
  const ownerEmail = `duena+${unique}@naranjapimienta.local`;
  const signup = await owner.post('/auth/register', {
    organizationName: businessName,
    name: 'Nueva Administradora',
    email: ownerEmail,
    password: 'Duenia123!',
  });
  check('registro público 201', signup.status === 201, JSON.stringify(signup.body));
  check('el registro deja sesión con rol ADMIN', signup.body?.user?.roles?.includes('ADMIN'), JSON.stringify(signup.body));

  const ownerMe = await owner.get('/auth/me');
  check('me incluye la organización nueva', ownerMe.body?.organization?.name === businessName, JSON.stringify(ownerMe.body?.organization));

  const isolatedCatalog = await owner.get('/catalog/products');
  check(
    'el negocio nuevo no ve catálogo de otra organización',
    isolatedCatalog.status === 200 && Array.isArray(isolatedCatalog.body) && isolatedCatalog.body.length === 0,
    JSON.stringify(isolatedCatalog.body),
  );

  const renamed = await owner.patch('/organizations/current', {
    name: 'Café Renombrado',
  });
  check(
    'el administrador renombra su negocio',
    renamed.status === 200 && renamed.body?.name === 'Café Renombrado',
    JSON.stringify(renamed.body),
  );

  console.log('\n[onboarding]');
  check(
    'la cuenta recién creada no está onboardeada',
    ownerMe.body?.onboarded === false,
    JSON.stringify(ownerMe.body?.onboarded),
  );

  const businessDomain = `cafe-${unique}.cafe`;
  const freeDomain = await owner.get(
    `/organizations/domain-available?domain=${businessDomain}`,
  );
  check(
    'el dominio libre está disponible',
    freeDomain.body?.available === true,
    JSON.stringify(freeDomain.body),
  );

  const invalidDomain = await owner.get(
    '/organizations/domain-available?domain=sin-punto',
  );
  check(
    'el dominio fuera de formato no está disponible',
    invalidDomain.body?.available === false &&
      invalidDomain.body?.reason === 'invalid',
    JSON.stringify(invalidDomain.body),
  );

  const withDomain = await owner.patch('/organizations/current', {
    domain: businessDomain,
  });
  check(
    'guarda el dominio del negocio',
    withDomain.status === 200 && withDomain.body?.domain === businessDomain,
    JSON.stringify(withDomain.body),
  );

  const takenDomain = await owner.get(
    `/organizations/domain-available?domain=${businessDomain}`,
  );
  check(
    'el dominio recién elegido ya aparece ocupado',
    takenDomain.body?.available === false &&
      takenDomain.body?.reason === 'taken',
    JSON.stringify(takenDomain.body),
  );

  const suggestion = await owner.get(
    '/users/username-suggestion?name=Ana%20P%C3%A9rez',
  );
  check(
    'propone el usuario nombre@dominio',
    suggestion.body?.username === `ana@${businessDomain}`,
    JSON.stringify(suggestion.body),
  );

  const domainEmployee = await owner.post('/users', {
    username: suggestion.body?.username,
    name: 'Ana Pérez',
    password: 'Equipo123!',
    roles: ['WAITER'],
  });
  check(
    'crea la cuenta con el usuario propuesto',
    domainEmployee.status === 201,
    JSON.stringify(domainEmployee.body),
  );

  const fallbackSuggestion = await owner.get(
    '/users/username-suggestion?name=Ana%20P%C3%A9rez',
  );
  check(
    'si el nombre ya existe propone inicial.apellido@dominio',
    fallbackSuggestion.body?.username === `a.perez@${businessDomain}`,
    JSON.stringify(fallbackSuggestion.body),
  );

  const domainLogin = await login(new Client(), {
    identifier: `ana@${businessDomain}`,
    password: 'Equipo123!',
  });
  check(
    'el empleado inicia sesión con su usuario con dominio',
    domainLogin.status === 200,
    JSON.stringify(domainLogin.body),
  );

  const ownerUsername = `duena.${unique}`;
  const available = await owner.get(
    `/users/username-available?username=${ownerUsername.toUpperCase()}`,
  );
  check(
    'el usuario libre está disponible (normalizado)',
    available.body?.available === true && available.body?.username === ownerUsername,
    JSON.stringify(available.body),
  );

  const invalidUsername = await owner.get(
    '/users/username-available?username=a%20b',
  );
  check(
    'el usuario fuera de formato no está disponible',
    invalidUsername.body?.available === false &&
      invalidUsername.body?.reason === 'invalid',
    JSON.stringify(invalidUsername.body),
  );

  const profile = await owner.patch('/auth/me', {
    name: 'Dueña Onboardeada',
    username: ownerUsername.toUpperCase(),
  });
  check(
    'guarda nombre y usuario del onboarding',
    profile.status === 200 && profile.body?.username === ownerUsername,
    JSON.stringify(profile.body),
  );

  const takenUsername = await owner.get(
    `/users/username-available?username=${ownerUsername}`,
  );
  check(
    'el usuario recién elegido ya aparece ocupado',
    takenUsername.body?.available === false &&
      takenUsername.body?.reason === 'taken',
    JSON.stringify(takenUsername.body),
  );

  const completed = await owner.post('/auth/onboarding/complete');
  check(
    'completa el onboarding',
    completed.status === 200 && completed.body?.onboarded === true,
    JSON.stringify(completed.body),
  );

  const meAfterOnboarding = await owner.get('/auth/me');
  check('me refleja el onboarding completo', meAfterOnboarding.body?.onboarded === true);

  const completedAgain = await owner.post('/auth/onboarding/complete');
  check('completar de nuevo es idempotente', completedAgain.status === 200);

  console.log('\n[usuarios]');
  const waiterUsername = `mesero.${unique}`;
  const waiterEmail = `mesero+${unique}@naranjapimienta.local`;
  const created = await admin.post('/users', {
    username: waiterUsername,
    email: waiterEmail,
    name: 'Mesero de prueba',
    password: 'Mesero123!',
    roles: ['WAITER'],
  });
  check('admin crea usuario 201', created.status === 201, JSON.stringify(created.body));
  const waiterId = created.body?.id;

  const list = await admin.get('/users');
  check('la lista incluye al mesero', Array.isArray(list.body) && list.body.some((u) => u.username === waiterUsername));

  const waiter = new Client();
  const waiterLogin = await login(waiter, {
    identifier: waiterUsername,
    password: 'Mesero123!',
  });
  check('login con nombre de usuario 200', waiterLogin.status === 200, JSON.stringify(waiterLogin.body));

  const waiterMe = await waiter.get('/auth/me');
  check(
    'una cuenta interna ya nace onboardeada',
    waiterMe.body?.onboarded === true,
    JSON.stringify(waiterMe.body?.onboarded),
  );

  const usernameConflict = await owner.patch('/auth/me', {
    username: waiterUsername,
  });
  check(
    'no se puede tomar el usuario de otra cuenta → 409',
    usernameConflict.status === 409,
    String(usernameConflict.status),
  );

  const waiterRename = await waiter.patch('/organizations/current', {
    name: 'Nombre ajeno',
  });
  check('mesero no puede renombrar el negocio → 403', waiterRename.status === 403, String(waiterRename.status));

  const forbidden = await waiter.get('/users');
  check('mesero no puede listar usuarios → 403', forbidden.status === 403, String(forbidden.status));

  console.log('\n[verificación de correo]');
  // El administrador crea las cuentas internas con el correo ya verificado;
  // la verificación por enlace se prueba con la cuenta del registro público.
  const resend = await owner.post('/auth/resend-verification');
  check('reenvío de verificación 200', resend.status === 200, JSON.stringify(resend.body));
  const verifyMail = await lastMailTo(ownerEmail, 'Verifica tu correo');
  const verifyToken = verifyMail ? tokenFrom(verifyMail.text) : undefined;
  check('el correo incluye el enlace al frontend', Boolean(verifyMail?.text.includes(`http://localhost:3000/verify-email?token=`)));
  const verified = await owner.post('/auth/verify-email', { token: verifyToken });
  check('correo verificado', verified.status === 200, JSON.stringify(verified.body));
  const meAfterVerify = await owner.get('/auth/me');
  check('me refleja emailVerified', meAfterVerify.body?.emailVerified === true);

  console.log('\n[2FA: activación]');
  const enable = await waiter.post('/auth/2fa/enable');
  check('inicia activación de 2FA', enable.status === 200 && Boolean(enable.body?.challengeId), JSON.stringify(enable.body));
  const enableMail = await lastMailTo(waiterEmail, 'Activa la verificación');
  const enableCode = enableMail ? codeFrom(enableMail.text) : undefined;
  const confirmed = await waiter.post('/auth/2fa/enable/confirm', {
    challengeId: enable.body?.challengeId,
    code: enableCode,
  });
  check('confirma 2FA', confirmed.status === 200, JSON.stringify(confirmed.body));

  console.log('\n[2FA: login en dos pasos]');
  await waiter.post('/auth/logout');
  check('logout borra las cookies de sesión', waiter.cookies.size === 0);

  const challengeClient = new Client();
  const challengeLogin = await login(challengeClient, {
    identifier: waiterEmail,
    password: 'Mesero123!',
  });
  check('login pide segundo factor', challengeLogin.status === 200 && challengeLogin.body?.twoFactorRequired === true, JSON.stringify(challengeLogin.body));
  check('no entrega cookies de sesión', challengeClient.cookies.size === 0);

  const loginMail = await lastMailTo(waiterEmail, 'código de acceso');
  const loginCode = loginMail ? codeFrom(loginMail.text) : undefined;
  const verifiedCode = await challengeClient.post('/auth/2fa/verify', {
    challengeId: challengeLogin.body?.challengeId,
    code: loginCode,
  });
  check('código 2FA válido emite sesión', verifiedCode.status === 200 && Boolean(verifiedCode.body?.user), JSON.stringify(verifiedCode.body));

  const badCode = await challengeClient.post('/auth/2fa/verify', {
    challengeId: challengeLogin.body?.challengeId,
    code: '000000',
  });
  check('rechaza código 2FA reutilizado/inválido', badCode.status === 401, String(badCode.status));

  console.log('\n[recuperación de contraseña]');
  const forgot = await waiter.post('/auth/forgot-password', { email: waiterEmail });
  check('forgot-password responde 200', forgot.status === 200);
  const resetMail = await lastMailTo(waiterEmail, 'Recupera tu contraseña');
  const resetToken = resetMail ? tokenFrom(resetMail.text) : undefined;
  check('el correo incluye el enlace de recuperación', Boolean(resetMail?.text.includes(`http://localhost:3000/reset-password?token=`)));
  const reset = await waiter.post('/auth/reset-password', {
    token: resetToken,
    password: 'Mesero456!',
  });
  check('reset-password 200', reset.status === 200, JSON.stringify(reset.body));

  const oldLogin = await login(new Client(), {
    identifier: waiterEmail,
    password: 'Mesero123!',
  });
  check('la contraseña anterior ya no funciona', oldLogin.status === 401, String(oldLogin.status));

  const newClient = new Client();
  const newLogin = await login(newClient, {
    identifier: waiterEmail,
    password: 'Mesero456!',
  });
  check('login exige 2FA con la contraseña nueva', newLogin.body?.twoFactorRequired === true, JSON.stringify(newLogin.body));

  const newLoginMail = await lastMailTo(waiterEmail, 'código de acceso');
  const newLoginCode = newLoginMail ? codeFrom(newLoginMail.text) : undefined;
  const newSession = await newClient.post('/auth/2fa/verify', {
    challengeId: newLogin.body?.challengeId,
    code: newLoginCode,
  });
  check('sesión nueva tras recuperación', newSession.status === 200, JSON.stringify(newSession.body));

  console.log('\n[desactivación]');
  const deactivated = await admin.delete(`/users/${waiterId}`);
  check('admin desactiva al mesero', deactivated.status === 200, JSON.stringify(deactivated.body));

  const afterDeactivate = await newClient.get('/auth/me');
  check('la sesión activa del mesero deja de funcionar (401)', afterDeactivate.status === 401, String(afterDeactivate.status));

  console.log(
    `\n${total} comprobaciones · ${total - failures} PASS · ${failures} FAIL`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exitCode = 1;
});
