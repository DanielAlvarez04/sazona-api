import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresignImageDto } from './dto/presign-image.dto';
import {
  IMAGE_CONTENT_TYPES,
  UPLOAD_URL_EXPIRES_IN,
  buildObjectKey,
  maxUploadBytes,
  presignPutUrl,
  publicUrlForKey,
  type UploadModule,
} from './r2';

export interface PresignImageResult {
  /** Clave del objeto; es lo que se guarda en la base de datos. */
  key: string;
  /** URL pública final del archivo. */
  url: string;
  /** URL firmada a la que el navegador hace el PUT. */
  uploadUrl: string;
  method: 'PUT';
  /** Cabeceras que el navegador debe enviar tal cual (firmadas). */
  headers: Record<string, string>;
  expiresIn: number;
  maxBytes: number;
}

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Firma una subida directa del navegador a R2.
   *
   * La imagen se sube a la carpeta de la entidad (`{org}/{tab}/{id}/`), así que
   * la entidad ya debe existir: el diálogo guarda primero el artículo y luego
   * sube la imagen. No hay área temporal ni objetos huérfanos.
   *
   * El `Content-Type` va firmado, así que el objeto se guarda con el tipo
   * declarado. R2 no permite fijar el tamaño en la firma de un PUT: el límite
   * de 5 MB se valida aquí, en el cliente y, al guardar, con el tamaño real
   * del objeto.
   */
  async presignImage(
    organizationId: string | null,
    module: UploadModule,
    entityId: string,
    dto: PresignImageDto,
  ): Promise<PresignImageResult> {
    if (!organizationId) {
      throw new BadRequestException(
        'Selecciona una organización antes de subir imágenes',
      );
    }

    if (!(dto.contentType in IMAGE_CONTENT_TYPES)) {
      throw new BadRequestException('Formato no admitido. Usa JPG, PNG o WebP');
    }

    const maxBytes = maxUploadBytes();

    if (dto.size > maxBytes) {
      throw new BadRequestException(
        `La imagen supera el máximo de ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    }

    const exists =
      module === 'catalog'
        ? await this.prisma.item.count({
            where: { id: entityId, organizationId },
          })
        : await this.prisma.ingredient.count({
            where: { id: entityId, organizationId },
          });

    if (!exists) {
      throw new NotFoundException('La entidad no existe en este negocio');
    }

    const key = buildObjectKey(
      organizationId,
      module,
      entityId,
      dto.contentType,
    );

    return {
      key,
      url: publicUrlForKey(key),
      uploadUrl: await presignPutUrl(key, dto.contentType),
      method: 'PUT',
      headers: { 'Content-Type': dto.contentType },
      expiresIn: UPLOAD_URL_EXPIRES_IN,
      maxBytes,
    };
  }
}
