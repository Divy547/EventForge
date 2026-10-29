import { ApiProperty } from '@nestjs/swagger';

export class IngestEventResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'order.created' })
  eventType!: string;

  @ApiProperty({ example: 'billing-service' })
  source!: string;

  @ApiProperty({ example: 'ACCEPTED' })
  status!: string;

  @ApiProperty({ example: false })
  isDuplicate!: boolean;

  @ApiProperty({ example: '2026-10-21T18:49:00.000Z' })
  createdAt!: string;
}

export class EventDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiProperty({ nullable: true })
  idempotencyKey!: string | null;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  source!: string;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiProperty()
  metadata!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: string;
}

export class PaginatedEventsResponseDto {
  @ApiProperty({ type: [EventDetailResponseDto] })
  data!: EventDetailResponseDto[];

  @ApiProperty()
  meta!: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
