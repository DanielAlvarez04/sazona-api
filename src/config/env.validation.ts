/**
 * Validación de variables de entorno al arranque (plan.md §12).
 * Falla rápido si falta algo imprescindible; en producción exige secretos fuertes.
 */
const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

const INSECURE_SECRETS = new Set([
  'cambiar-en-produccion',
  'default-secret',
  'secret',
  'changeme',
]);

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of REQUIRED) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Falta la variable de entorno obligatoria ${key}`);
    }
  }

  const isProduction = config.NODE_ENV === 'production';

  const hasGoogleId = Boolean(config.GOOGLE_CLIENT_ID);
  const hasGoogleSecret = Boolean(config.GOOGLE_CLIENT_SECRET);

  if (hasGoogleId !== hasGoogleSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET deben configurarse juntas (o ninguna)',
    );
  }

  if (isProduction) {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = String(config[key]);

      if (INSECURE_SECRETS.has(value) || value.length < 32) {
        throw new Error(
          `La variable ${key} debe ser un secreto de al menos 32 caracteres en producción`,
        );
      }
    }

    if (!config.RESEND_API_KEY) {
      throw new Error(
        'RESEND_API_KEY es obligatoria en producción para verificación, recuperación y 2FA',
      );
    }

    if (!config.WEB_ORIGIN) {
      throw new Error('WEB_ORIGIN es obligatoria en producción');
    }
  }

  return config;
}
