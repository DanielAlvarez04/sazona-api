import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UnitCode } from '@prisma/client';

export class RecipeIngredientInputDto {
  @IsString()
  @MinLength(1)
  ingredientId!: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  quantity!: number;

  /** Unidad de la cantidad; si se omite se interpreta en la unidad base. */
  @IsOptional()
  @IsEnum(UnitCode)
  unit?: UnitCode;
}

export class UpsertRecipeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  /** `null` o ausente = receta base del producto. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  variantId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientInputDto)
  ingredients!: RecipeIngredientInputDto[];
}
