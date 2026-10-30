import { IsIn, IsInt, Max, Min } from 'class-validator';
import { IMAGE_CONTENT_TYPES, type ImageContentType } from '../r2';

const CONTENT_TYPES = Object.keys(IMAGE_CONTENT_TYPES) as ImageContentType[];

/** Datos que el navegador declara antes de subir una imagen. */
export class PresignImageDto {
  @IsIn(CONTENT_TYPES, {
    message: 'Formato no admitido. Usa JPG, PNG o WebP',
  })
  contentType!: ImageContentType;

  /** Tamaño en bytes. El bucket rechaza cualquier archivo mayor. */
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  size!: number;
}
