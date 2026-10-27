import { Role } from '@prisma/client';
import {
  PERMISSIONS,
  permissionsForRoles,
  rolesHavePermission,
} from './permissions';

const ALL_ROLES = Object.values(Role);

describe('matriz de permisos', () => {
  it('solo usa roles existentes', () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) {
        expect(ALL_ROLES).toContain(role);
      }
      expect(permission).toMatch(/^[a-z]+:[a-z:]+$/);
    }
  });

  it('ADMIN tiene todos los permisos', () => {
    expect(permissionsForRoles([Role.ADMIN]).sort()).toEqual(
      Object.keys(PERMISSIONS).sort(),
    );
  });

  it('un mesero no puede gestionar usuarios ni confirmar pagos', () => {
    expect(rolesHavePermission([Role.WAITER], 'users:manage')).toBe(false);
    expect(rolesHavePermission([Role.WAITER], 'payments:confirm')).toBe(false);
    expect(rolesHavePermission([Role.WAITER], 'orders:send')).toBe(true);
  });

  it('cocina solo puede mover estados de cocina', () => {
    expect(rolesHavePermission([Role.KITCHEN], 'kitchen:transition')).toBe(
      true,
    );
    expect(rolesHavePermission([Role.KITCHEN], 'inventory:manage')).toBe(false);
  });

  it('un usuario con varios roles acumula permisos', () => {
    const roles = [Role.WAITER, Role.INVENTORY_MANAGER];

    expect(rolesHavePermission(roles, 'orders:send')).toBe(true);
    expect(rolesHavePermission(roles, 'inventory:adjust')).toBe(true);
    expect(rolesHavePermission(roles, 'users:manage')).toBe(false);
  });

  it('sin roles no hay permisos', () => {
    expect(permissionsForRoles([])).toEqual([]);
  });
});
