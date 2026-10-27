import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

function createMocks() {
  const prisma: Record<string, any> = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organization: { findUnique: jest.fn() },
    membership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    authSession: { updateMany: jest.fn() },
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => unknown)(prisma),
    ),
  };

  const service = new UsersService(prisma as unknown as PrismaService);

  return { service, prisma };
}

describe('UsersService', () => {
  it('lista solo las membresías de la organización de la sesión', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findMany.mockResolvedValue([]);

    await service.list('org-1');

    expect(prisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
  });

  it('no permite duplicar el nombre de usuario', async () => {
    const { service, prisma } = createMocks();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1' })
      .mockResolvedValueOnce(null);

    await expect(
      service.create('org-1', {
        username: 'mesero',
        password: 'Naranja123!',
        roles: [Role.WAITER],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.membership.create).not.toHaveBeenCalled();
  });

  it('no permite duplicar el correo', async () => {
    const { service, prisma } = createMocks();
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'user-1', email: 'ocupado@naranjapimienta.local' });

    await expect(
      service.create('org-1', {
        username: 'nuevo',
        email: 'ocupado@naranjapimienta.local',
        password: 'Naranja123!',
        roles: [Role.WAITER],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza nombres de usuario inválidos', async () => {
    const { service } = createMocks();

    await expect(
      service.create('org-1', {
        username: 'a b',
        password: 'Naranja123!',
        roles: [Role.WAITER],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crea una cuenta interna sin correo y su membresía', async () => {
    const { service, prisma } = createMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      username: 'cocina',
      email: null,
      name: 'Cocina',
    });
    prisma.membership.create.mockResolvedValue({
      roles: [Role.KITCHEN],
    });

    const result = await service.create('org-1', {
      username: 'Cocina',
      password: 'Naranja123!',
      name: 'Cocina',
      roles: [Role.KITCHEN],
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'cocina',
        email: null,
        emailVerified: false,
        onboardedAt: expect.any(Date),
      }),
    });
    expect(prisma.membership.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-2',
        organizationId: 'org-1',
        roles: [Role.KITCHEN],
      },
    });
    expect(result).toMatchObject({
      id: 'user-2',
      username: 'cocina',
      roles: [Role.KITCHEN],
    });
  });

  it('indica que un nombre de usuario libre está disponible', async () => {
    const { service, prisma } = createMocks();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.usernameAvailable(' Ana.Perez ');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'ana.perez' },
    });
    expect(result).toEqual({ username: 'ana.perez', available: true });
  });

  it('marca como no disponible un nombre de usuario ocupado', async () => {
    const { service, prisma } = createMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'otro' });

    const result = await service.usernameAvailable('ana.perez');

    expect(result).toEqual({
      username: 'ana.perez',
      available: false,
      reason: 'taken',
    });
  });

  it('marca como inválido un nombre de usuario fuera de formato', async () => {
    const { service, prisma } = createMocks();

    const result = await service.usernameAvailable('a b');

    expect(result).toEqual({
      username: 'a b',
      available: false,
      reason: 'invalid',
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('acepta usuarios con el dominio del negocio', async () => {
    const { service, prisma } = createMocks();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.usernameAvailable(' Ana@NaranjaPimienta.Cafe ');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'ana@naranjapimienta.cafe' },
    });
    expect(result).toEqual({
      username: 'ana@naranjapimienta.cafe',
      available: true,
    });
  });

  it('propone nombre@dominio cuando está libre', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue({
      domain: 'naranjapimienta.cafe',
    });
    prisma.user.findMany.mockResolvedValue([]);

    const result = await service.suggestUsername('org-1', 'Ana Pérez');

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { domain: true },
    });
    expect(result).toEqual({
      username: 'ana@naranjapimienta.cafe',
      domain: 'naranjapimienta.cafe',
    });
  });

  it('usa inicial.apellido si el nombre ya está ocupado', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue({
      domain: 'naranjapimienta.cafe',
    });
    prisma.user.findMany.mockResolvedValue([
      { username: 'ana@naranjapimienta.cafe' },
    ]);

    const result = await service.suggestUsername('org-1', 'Ana Pérez');

    expect(result.username).toBe('a.perez@naranjapimienta.cafe');
  });

  it('añade un número si el nombre y la inicial.apellido están ocupados', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue({
      domain: 'naranjapimienta.cafe',
    });
    prisma.user.findMany.mockResolvedValue([
      { username: 'ana@naranjapimienta.cafe' },
      { username: 'a.perez@naranjapimienta.cafe' },
    ]);

    const result = await service.suggestUsername('org-1', 'Ana Pérez');

    expect(result.username).toBe('a.perez2@naranjapimienta.cafe');
  });

  it('sin dominio configurado mantiene el formato antiguo', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue({ domain: null });
    prisma.user.findMany.mockResolvedValue([]);

    const result = await service.suggestUsername('org-1', 'Ana Pérez');

    expect(result).toEqual({ username: 'ana', domain: null });
  });

  it('impide que un administrador se desactive a sí mismo', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      roles: [Role.ADMIN],
      user: { email: 'admin@naranjapimienta.local', name: 'Admin' },
    });

    await expect(
      service.update('org-1', 'user-1', { isActive: false }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('impide quitarse el rol ADMIN a sí mismo', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      roles: [Role.ADMIN],
      user: { email: 'admin@naranjapimienta.local', name: 'Admin' },
    });

    await expect(
      service.update('org-1', 'user-1', { roles: [Role.WAITER] }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige que quede al menos un administrador activo', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      roles: [Role.ADMIN],
      user: { email: 'otro@naranjapimienta.local', name: 'Otro' },
    });
    prisma.membership.count.mockResolvedValue(0);

    await expect(
      service.update('org-1', 'user-2', { roles: [Role.WAITER] }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no permite operar sobre usuarios de otra organización', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(
      service.update('org-1', 'user-ajeno', { name: 'X' }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('actualiza el nombre sin tocar el nombre de usuario', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-2',
      roles: [Role.WAITER],
      user: { email: null, username: 'mesero', name: 'Mesero' },
    });
    prisma.membership.update.mockResolvedValue({
      roles: [Role.WAITER],
      isActive: true,
    });

    const result = await service.update(
      'org-1',
      'user-2',
      { name: 'Mesero', surname: 'Pérez' },
      'user-1',
    );

    // El ID (`username`) es inmutable: la actualización no lo envía.
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: expect.objectContaining({ name: 'Mesero Pérez' }),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: expect.not.objectContaining({ username: expect.anything() }),
    });
    expect(result.username).toBe('mesero');
  });

  it('actualiza la contraseña y revoca las sesiones', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-2',
      roles: [Role.WAITER],
      user: { email: null, username: 'mesero', name: 'Mesero' },
    });
    prisma.membership.update.mockResolvedValue({
      roles: [Role.WAITER],
      isActive: true,
    });

    await service.update(
      'org-1',
      'user-2',
      { password: 'Nueva123!' },
      'user-1',
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: expect.objectContaining({
        passwordHash: expect.any(String),
      }),
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-2', revokedAt: null },
      }),
    );
  });

  it('al desactivar revoca las sesiones del usuario', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-2',
      roles: [Role.WAITER],
    });
    prisma.membership.update.mockResolvedValue({});

    await service.deactivate('org-1', 'user-2', 'user-1');

    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      data: { isActive: false },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-2', revokedAt: null },
      }),
    );
  });

  it('al eliminar borra la cuenta completa si no pertenece a otra organización', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-2',
      roles: [Role.WAITER],
    });
    prisma.membership.count.mockResolvedValue(0);

    await service.deleteMembership('org-1', 'user-2', 'user-1');

    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-2' },
    });
    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });

  it('al eliminar solo borra la membresía si la cuenta sigue en otra organización', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-2',
      roles: [Role.WAITER],
    });
    prisma.membership.count.mockResolvedValue(1);

    await service.deleteMembership('org-1', 'user-2', 'user-1');

    expect(prisma.membership.delete).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('no permite eliminarse a sí mismo', async () => {
    const { service } = createMocks();

    await expect(
      service.deleteMembership('org-1', 'user-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('elimina en bloque saltándose al propio actor', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-2',
      userId: 'user-2',
      roles: [Role.WAITER],
    });
    prisma.membership.count.mockResolvedValue(0);

    const result = await service.deleteMemberships(
      'org-1',
      ['user-1', 'user-2', 'user-2'],
      'user-1',
    );

    expect(result).toEqual({ ok: true, deletedCount: 1 });
    expect(prisma.user.delete).toHaveBeenCalledTimes(1);
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-2' },
    });
  });

  it('purgar desactivados borra la cuenta conservando sus registros', async () => {
    const { service, prisma } = createMocks();
    prisma.membership.findMany.mockResolvedValue([
      { id: 'membership-2', userId: 'user-2' },
    ]);
    prisma.membership.count.mockResolvedValue(0);

    const result = await service.purgeDeletedUsers('org-1');

    expect(result).toEqual({ ok: true, deletedCount: 1 });
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-2' },
    });
  });
});
