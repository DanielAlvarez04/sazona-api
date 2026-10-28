/**
 * Límites de uso justo para sucursales.
 *
 * No hay cobro por sucursal todavía; estos topes evitan que una sola cuenta
 * consuma recursos de todas las demás. Se aplican en la API, no solo en la UI.
 */
export const BRANCH_LIMITS = {
  /** Sucursales activas por organización. */
  maxActiveBranches: 5,
  /** Usuarios activos sugeridos por sucursal (aviso en la UI, no bloquea). */
  recommendedUsersPerBranch: 15,
} as const;
