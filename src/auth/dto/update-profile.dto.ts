import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^[a-zA-Z0-9._-]+(@[a-zA-Z0-9.-]+)?$/, {
    message:
      'El usuario admite letras, números, punto, guion, guion bajo y, opcionalmente, @dominio',
  })
  username?: string;
}
