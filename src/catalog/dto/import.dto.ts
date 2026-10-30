import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ImportItemsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000, {
    message: 'El CSV supera el tamaño máximo de 1 MB',
  })
  csv!: string;

  /** Valida y reporta sin escribir nada. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
