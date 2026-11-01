import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min, IsDateString, IsIn } from 'class-validator';

export class ListDeliveriesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by delivery status. Defaults to DEAD_LETTER when listing DLQ.',
    enum: ['PENDING', 'IN_FLIGHT', 'COMPLETED', 'FAILED', 'DEAD_LETTER'],
    default: 'DEAD_LETTER',
  })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'IN_FLIGHT', 'COMPLETED', 'FAILED', 'DEAD_LETTER'])
  status?: string = 'DEAD_LETTER';

  @ApiPropertyOptional({ description: 'Filter by subscription UUID' })
  @IsOptional()
  @IsUUID('4')
  subscriptionId?: string;

  @ApiPropertyOptional({ description: 'Filter by event UUID' })
  @IsOptional()
  @IsUUID('4')
  eventId?: string;

  @ApiPropertyOptional({ description: 'Filter deliveries created at or after this ISO timestamp' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter deliveries created at or before this ISO timestamp' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
