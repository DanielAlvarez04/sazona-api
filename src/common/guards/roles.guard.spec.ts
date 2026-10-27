import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contextWithUser(user?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const guard = new RolesGuard(reflector);

  it('permite el paso si no hay permisos declarados', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(guard.canActivate(contextWithUser())).toBe(true);
  });

  it('rechaza si no hay usuario autenticado', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      'users:manage',
    ]);
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un permiso que el rol no tiene', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      'users:manage',
    ]);
    const ctx = contextWithUser({
      sub: 'u1',
      roles: [Role.WAITER],
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('permite cuando el rol incluye el permiso', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      'users:manage',
    ]);
    const ctx = contextWithUser({ sub: 'u1', roles: [Role.ADMIN] });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('exige todos los permisos declarados', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      'users:manage',
      'payments:confirm',
    ]);
    const ctx = contextWithUser({ sub: 'u1', roles: [Role.CASHIER] });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
