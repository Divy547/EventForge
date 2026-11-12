import { ApiProperty } from '@nestjs/swagger';

export class DeliveryStatusCountsDto {
  @ApiProperty() PENDING!: number;
  @ApiProperty() IN_FLIGHT!: number;
  @ApiProperty() COMPLETED!: number;
  @ApiProperty() FAILED!: number;
  @ApiProperty() DEAD_LETTER!: number;
}

export class RecentFailureDto {
  @ApiProperty() deliveryId!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() subscriptionId!: string;
  @ApiProperty() subscriptionName!: string;
  @ApiProperty({ description: 'FAILED (will retry) or DEAD_LETTER' }) status!: string;
  @ApiProperty() attemptsCount!: number;
  @ApiProperty({ nullable: true }) lastStatusCode!: number | null;
  @ApiProperty({ nullable: true }) lastError!: string | null;
  @ApiProperty() updatedAt!: string;
}

export class StatsResponseDto {
  @ApiProperty({ example: 24 }) windowHours!: number;
  @ApiProperty({ description: 'Start of the look-back window (ISO timestamp)' }) since!: string;
  @ApiProperty({ description: 'Events ingested within the window' }) eventsTotal!: number;
  @ApiProperty({ description: 'Deliveries created within the window' }) deliveriesTotal!: number;
  @ApiProperty({ type: DeliveryStatusCountsDto }) deliveriesByStatus!: DeliveryStatusCountsDto;
  @ApiProperty({
    nullable: true,
    description:
      'COMPLETED / (COMPLETED + DEAD_LETTER) among deliveries in the window, as a fraction 0..1. ' +
      'Null when no delivery has reached a final state yet.',
  })
  successRate!: number | null;
  @ApiProperty({ type: [RecentFailureDto] }) recentFailures!: RecentFailureDto[];
}
