import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UnitCode } from '@prisma/client';

export class ImportIngredientRowDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(UnitCode)
  baseUnit?: UnitCode;

  /** Obligatoria: el SKU se deriva del prefijo de la categoría. */
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  currentStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minStock?: number;
}

const DECIMAL_PATTERN = /^-?\d{1,9}(\.\d{1,6})?$/;

export class CreateIngredientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(UnitCode)
  baseUnit?: UnitCode;

  /** Obligatoria: el SKU se deriva del prefijo de la categoría. */
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  /** Stock inicial (se registra como movimiento de ajuste auditable). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  currentStock?: number;
}

export class CreateIngredientsBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateIngredientDto)
  ingredients!: CreateIngredientDto[];
}

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(UnitCode)
  baseUnit?: UnitCode;

  /**
   * Cambiar de categoría regenera el SKU con el prefijo de la nueva categoría.
   * El SKU nunca se edita directamente.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateAdjustmentDto {
  @IsString()
  @MinLength(1)
  ingredientId!: string;

  /**
   * Cantidad con signo en la unidad base del ingrediente (o en `unit`).
   * Positivo = entrada, negativo = salida.
   */
  @IsString()
  @Matches(DECIMAL_PATTERN, {
    message: 'La cantidad debe ser un número decimal (máx. 6 decimales)',
  })
  quantity!: string;

  @IsOptional()
  @IsEnum(UnitCode)
  unit?: UnitCode;

  @IsString()
  @MinLength(3)
  @MaxLength(280)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  referenceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dedupeKey?: string;
}

export class CreateEquivalenceDto {
  @IsEnum(UnitCode)
  fromUnit!: UnitCode;

  @IsEnum(UnitCode)
  toUnit!: UnitCode;

  /** 1 `fromUnit` = `factor` `toUnit`. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  factor!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
