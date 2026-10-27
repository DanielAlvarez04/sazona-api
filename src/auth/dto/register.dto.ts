import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  /** Nombre del negocio que se creará con esta cuenta. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  organizationName?: string;
}
