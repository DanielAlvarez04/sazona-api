import { IsString, Length, MinLength } from 'class-validator';

export class TwoFactorChallengeDto {
  @IsString()
  @MinLength(10)
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(1)
  password!: string;
}
