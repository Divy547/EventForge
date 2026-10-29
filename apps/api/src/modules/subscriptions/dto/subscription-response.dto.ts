import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  projectId!: string;

  @ApiProperty({ example: 'Customer Billing Webhook' })
  name!: string;

  @ApiProperty({ example: 'https://api.example.com/webhooks/orders' })
  targetUrl!: string;

  @ApiProperty({ example: ['order.created'] })
  eventTypes!: string[];

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ example: 50, nullable: true })
  rateLimitPerSecond!: number | null;

  @ApiPropertyOptional({ example: { 'X-Custom-Header': 'EventForge-Webhook' }, nullable: true })
  headers!: Record<string, string> | null;

  @ApiProperty({ example: '2026-10-21T18:50:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-21T18:50:00.000Z' })
  updatedAt!: string;
}

export class CreatedSubscriptionResponseDto extends SubscriptionResponseDto {
  @ApiProperty({
    example: 'whsec_9876543210abcdef...',
    description:
      'Webhook signing secret (HMAC-SHA256). SAVE THIS NOW; it is shown only upon creation and never returned in subsequent queries.',
  })
  signingSecret!: string;
}
