import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, Matches, IsObject, IsOptional } from 'class-validator';

export class IngestEventDto {
  @ApiProperty({
    example: 'order.created',
    description: 'Hierarchical event type identifier',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'eventType must contain only alphanumeric characters, dots, underscores, or hyphens',
  })
  eventType!: string;

  @ApiProperty({
    example: 'billing-service',
    description: 'Originating producer or service name',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  source!: string;

  @ApiProperty({
    example: { orderId: 'ord_123', amount: 99.99, currency: 'USD' },
    description: 'JSON event payload data',
  })
  @IsObject()
  @IsNotEmpty()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: { traceId: 'tr_abc123', environment: 'production' },
    description: 'Arbitrary operational metadata associated with the event',
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'idem_key_987654',
    description: 'Client-supplied idempotency key for deduplication',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  idempotencyKey?: string;
}
