import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class DeleteMembershipsDto {
  /** IDs de los usuarios a eliminar de la organización. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userIds!: string[];
}
