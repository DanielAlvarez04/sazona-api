import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** Correo electrónico o nombre de usuario de una cuenta interna. */
  @IsString()
  @MinLength(3)
  identifier!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
