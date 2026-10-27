-- Las cuentas que ya existían cuando se añadió el onboarding quedaron marcadas
-- como "onboardeadas" en 20261026190000_user_onboarding, pero nunca pasaron por
-- el flujo. Vuelven a quedar pendientes para que aparezca en su próximo inicio
-- de sesión.
--
-- Las cuentas internas (no ADMIN) no lo ven: el layout solo redirige a ADMIN
-- porque el paso del negocio exige `organization:manage`.
UPDATE "User" SET "onboardedAt" = NULL;
