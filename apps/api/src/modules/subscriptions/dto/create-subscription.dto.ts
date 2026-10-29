import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUrl,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsObject,
} from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({
    example: 'Customer Billing Webhook',
    description: 'Human-readable label for the subscription',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    example: 'https://api.example.com/webhooks/orders',
    description: 'Target webhook delivery endpoint (HTTP/HTTPS only, public IPs)',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true })
  targetUrl!: string;

  @ApiProperty({
    example: ['order.created', 'payment.succeeded'],
    description: 'List of subscribed event type patterns (or ["*"] for all)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  eventTypes!: string[];

  @ApiPropertyOptional({
    example: 50,
    description: 'Optional egress rate limit (requests per second)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerSecond?: number;

  @ApiPropertyOptional({
    example: { 'X-Custom-Header': 'EventForge-Webhook' },
    description: 'Optional custom headers to deliver with each webhook POST',
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}
