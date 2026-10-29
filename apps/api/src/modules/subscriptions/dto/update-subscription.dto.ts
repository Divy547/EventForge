import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUrl,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsObject,
  IsBoolean,
} from 'class-validator';

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ example: 'Updated Billing Webhook' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'https://api.example.com/webhooks/v2' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  targetUrl?: string;

  @ApiPropertyOptional({ example: ['order.created'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  eventTypes?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerSecond?: number;

  @ApiPropertyOptional({ example: { 'X-Custom-Header': 'New-Value' } })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}
