import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from './organizations.service';

function createMocks() {
  const prisma: Record<string, any> = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const service = new OrganizationsService(prisma as unknown as PrismaService);

  return { service, prisma };
}

describe('OrganizationsService', () => {
  it('devuelve la organización de la sesión', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Naranja Pimienta',
      slug: 'naranja-pimienta',
      isActive: true,
    });

    const result = await service.current('org-1');

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
    });
    expect(result).toMatchObject({ id: 'org-1', name: 'Naranja Pimienta' });
  });

  it('falla si la organización no existe', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.current('org-ajena')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('renombra solo la organización indicada y recorta espacios', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.update.mockResolvedValue({
      id: 'org-1',
      name: 'Café Central',
      slug: 'naranja-pimienta',
      isActive: true,
    });

    const result = await service.update('org-1', { name: '  Café Central  ' });

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { name: 'Café Central' },
    });
    expect(result.name).toBe('Café Central');
  });

  it('acepta un dominio libre y lo normaliza', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.update.mockResolvedValue({
      id: 'org-1',
      name: 'Café Central',
      slug: 'naranja-pimienta',
      domain: 'naranjapimienta.cafe',
      isActive: true,
    });

    const result = await service.update('org-1', {
      domain: ' NaranjaPimienta.Cafe ',
    });

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { domain: 'naranjapimienta.cafe' },
    });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { domain: 'naranjapimienta.cafe' },
    });
    expect(result.domain).toBe('naranjapimienta.cafe');
  });

  it('rechaza un dominio inválido', async () => {
    const { service, prisma } = createMocks();

    await expect(
      service.update('org-1', { domain: 'sin punto' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('no permite usar el dominio de otra organización', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-2' });

    await expect(
      service.update('org-1', { domain: 'naranjapimienta.cafe' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('indica la disponibilidad de un dominio', async () => {
    const { service, prisma } = createMocks();
    prisma.organization.findUnique.mockResolvedValueOnce(null);

    await expect(service.domainAvailable(' NaranjaPimienta.Cafe ')).resolves.toEqual({
      domain: 'naranjapimienta.cafe',
      available: true,
    });

    prisma.organization.findUnique.mockResolvedValueOnce({ id: 'org-2' });

    await expect(service.domainAvailable('naranjapimienta.cafe')).resolves.toEqual({
      domain: 'naranjapimienta.cafe',
      available: false,
      reason: 'taken',
    });

    await expect(service.domainAvailable('sin punto')).resolves.toEqual({
      domain: 'sin punto',
      available: false,
      reason: 'invalid',
    });
  });
});
