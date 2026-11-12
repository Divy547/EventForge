import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StatsQueryDto {
  @ApiPropertyOptional({
    description: 'Size of the look-back window in hours, counted back from now',
    default: 24,
    minimum: 1,
    maximum: 720,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  windowHours: number = 24;
}
