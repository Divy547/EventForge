import { ApiProperty } from '@nestjs/swagger';

export class DeliveryAttemptResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty({ nullable: true })
  statusCode!: number | null;

  @ApiProperty({ nullable: true })
  responseBodySnippet!: string | null;

  @ApiProperty()
  executionDurationMs!: number;

  @ApiProperty({ nullable: true })
  errorCode!: string | null;

  @ApiProperty({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class DeliverySummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  attemptsCount!: number;

  @ApiProperty()
  maxAttempts!: number;

  @ApiProperty({ nullable: true })
  nextRetryAt!: string | null;

  @ApiProperty({ nullable: true })
  completedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DeliveryDetailResponseDto extends DeliverySummaryResponseDto {
  @ApiProperty({ nullable: true })
  event?:
    | {
        id: string;
        eventType: string;
        source: string;
        createdAt: string;
      }
    | undefined;

  @ApiProperty({ nullable: true })
  subscription?:
    | {
        id: string;
        name: string;
        targetUrl: string;
        isActive: boolean;
      }
    | undefined;

  @ApiProperty({ type: [DeliveryAttemptResponseDto] })
  attempts!: DeliveryAttemptResponseDto[];
}

export class PaginatedDeliveriesResponseDto {
  @ApiProperty({ type: [DeliverySummaryResponseDto] })
  data!: DeliverySummaryResponseDto[];

  @ApiProperty()
  meta!: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
