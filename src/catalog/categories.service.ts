import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string | null, includeInactive = false) {
    return this.prisma.category.findMany({
      where: {
        organizationId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
  }

  async create(organizationId: string | null, dto: CreateCategoryDto) {
    const name = dto.name.trim();
    await this.assertNameAvailable(organizationId, name);

    return this.prisma.category.create({
      data: {
        organizationId,
        name,
        description: normalizeOptional(dto.description),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(organizationId: string | null, id: string, dto: UpdateCategoryDto) {
    const category = await this.find(organizationId, id);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== category.name) {
        await this.assertNameAvailable(organizationId, name, id);
      }
    }

    return this.prisma.category.update({
      where: { id: category.id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : normalizeOptional(dto.description),
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
  }

  async deactivate(organizationId: string | null, id: string) {
    const category = await this.find(organizationId, id);

    const activeProducts = await this.prisma.product.count({
      where: { categoryId: category.id, isActive: true },
    });

    if (activeProducts > 0) {
      throw new ConflictException(
        `La categoría tiene ${activeProducts} artículo(s) activo(s). Desactívalos o muévelos antes de desactivarla`,
      );
    }

    return this.prisma.category.update({
      where: { id: category.id },
      data: { isActive: false },
    });
  }

  private async find(organizationId: string | null, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, organizationId },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    return category;
  }

  private async assertNameAvailable(
    organizationId: string | null,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.category.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Ya existe una categoría con ese nombre');
    }
  }
}

function normalizeOptional(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

