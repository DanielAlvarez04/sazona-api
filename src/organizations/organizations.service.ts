import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isValidDomain,
  normalizeDomain,
} from '../common/usernames';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async current(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      domain: organization.domain,
      taxRate: organization.taxRate.toString(),
      isActive: organization.isActive,
    };
  }

  /** Comprueba si un dominio puede usarlo la organización (es único global). */
  async domainAvailable(rawDomain: string) {
    const domain = normalizeDomain(rawDomain ?? '');

    if (!isValidDomain(domain)) {
      return { domain, available: false, reason: 'invalid' as const };
    }

    const existing = await this.prisma.organization.findUnique({
      where: { domain },
    });

    if (existing) {
      return { domain, available: false, reason: 'taken' as const };
    }

    return { domain, available: true };
  }

  async update(organizationId: string, dto: UpdateOrganizationDto) {
    const data: {
      name?: string;
      domain?: string;
      taxRate?: Prisma.Decimal;
    } = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.domain !== undefined) {
      const domain = normalizeDomain(dto.domain);

      if (!isValidDomain(domain)) {
        throw new BadRequestException('El dominio no es válido');
      }

      const taken = await this.prisma.organization.findUnique({
        where: { domain },
      });

      if (taken && taken.id !== organizationId) {
        throw new ConflictException('Ese dominio ya está en uso');
      }

      data.domain = domain;
    }

    if (dto.taxRate !== undefined) {
      if (dto.taxRate < 0 || dto.taxRate > 1) {
        throw new BadRequestException(
          'La tasa de IVA debe estar entre 0 y 1 (0.16 = 16 %)',
        );
      }

      data.taxRate = new Prisma.Decimal(dto.taxRate);
    }

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data,
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      domain: organization.domain,
      taxRate: organization.taxRate.toString(),
      isActive: organization.isActive,
    };
  }
}
