import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DeliverySummaryResponseDto } from './delivery-response.dto.js';

export class ReplaySingleDeliveryDto {
  @ApiPropertyOptional({
    description: 'Number of additional attempt attempts to grant (1-10)',
    default: 3,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  additionalAttempts: number = 3;
}

export class ReplayBatchDeliveriesDto {
  @ApiPropertyOptional({
    description: 'List of specific delivery UUIDs to replay (max 50)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  deliveryIds?: string[];

  @ApiPropertyOptional({
    description: 'Optionally filter dead-letter deliveries by subscription UUID',
  })
  @IsOptional()
  @IsUUID('4')
  subscriptionId?: string;

  @ApiPropertyOptional({
    description: 'Additional attempts granted per replayed delivery (1-10)',
    default: 3,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  additionalAttempts: number = 3;

  @ApiPropertyOptional({
    description: 'Maximum batch size to replay in this request (1-50)',
    default: 50,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 50;
}

export class ReplayBatchItemResultDto {
  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  success!: boolean;

  @ApiPropertyOptional()
  status?: string | undefined;

  @ApiPropertyOptional()
  error?: string | undefined;

  @ApiPropertyOptional()
  statusCode?: number | undefined;
}

export class ReplayBatchResponseDto {
  @ApiProperty()
  totalRequested!: number;

  @ApiProperty()
  replayedCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiProperty({ type: [ReplayBatchItemResultDto] })
  items!: ReplayBatchItemResultDto[];
}

export class ReplaySingleResponseDto {
  @ApiProperty({ type: DeliverySummaryResponseDto })
  delivery!: DeliverySummaryResponseDto;

  @ApiProperty({ example: true })
  replayed!: boolean;

  @ApiProperty({ example: 'Delivery successfully reset to PENDING and enqueued for delivery' })
  message!: string;
}
