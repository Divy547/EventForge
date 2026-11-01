import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { DeliveriesService } from './deliveries.service.js';
import { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto.js';
import {
  PaginatedDeliveriesResponseDto,
  DeliveryDetailResponseDto,
} from './dto/delivery-response.dto.js';
import {
  ReplaySingleDeliveryDto,
  ReplaySingleResponseDto,
  ReplayBatchDeliveriesDto,
  ReplayBatchResponseDto,
} from './dto/replay-delivery.dto.js';
import { CurrentProject } from '../../common/decorators/current-project.decorator.js';
import type { AuthenticatedProject } from '../../common/guards/api-key.guard.js';

@ApiTags('Deliveries')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/deliveries')
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List deliveries with filters and pagination',
    description:
      'Retrieves a paginated list of deliveries scoped to the authenticated project. Defaults to DEAD_LETTER deliveries when status is not specified.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated deliveries response',
    type: PaginatedDeliveriesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async listDeliveries(
    @CurrentProject() project: AuthenticatedProject,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<PaginatedDeliveriesResponseDto> {
    return this.deliveriesService.listDeliveries(project.id, query);
  }

  /**
   * Batch replay route MUST be declared before parameterized ':id' routes
   * so that POST /v1/deliveries/replay is not matched as an ':id' parameter.
   */
  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch replay dead-letter deliveries',
    description:
      'Replays multiple DEAD_LETTER deliveries matching given criteria or ID list. Returns per-item execution status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Batch replay execution summary with per-item status',
    type: ReplayBatchResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async batchReplay(
    @CurrentProject() project: AuthenticatedProject,
    @Body() dto: ReplayBatchDeliveriesDto,
  ): Promise<ReplayBatchResponseDto> {
    return this.deliveriesService.batchReplay(project.id, dto);
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay single dead-letter delivery',
    description:
      'Atomically transitions a DEAD_LETTER delivery to PENDING, increases attempt headroom, and enqueues to BullMQ.',
  })
  @ApiParam({ name: 'id', description: 'Delivery UUID' })
  @ApiResponse({
    status: 200,
    description: 'Delivery replayed successfully',
    type: ReplaySingleResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 404, description: 'Delivery not found or not owned by project' })
  @ApiResponse({ status: 409, description: 'Delivery is not in DEAD_LETTER status' })
  async replayDelivery(
    @CurrentProject() project: AuthenticatedProject,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaySingleDeliveryDto,
  ): Promise<ReplaySingleResponseDto> {
    return this.deliveriesService.replayDelivery(project.id, id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve delivery details by ID',
    description:
      'Fetches complete delivery details, event summary, subscription info (secrets omitted), and chronological attempt history.',
  })
  @ApiParam({ name: 'id', description: 'Delivery UUID' })
  @ApiResponse({
    status: 200,
    description: 'Delivery details',
    type: DeliveryDetailResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 404, description: 'Delivery not found or not owned by project' })
  async getDeliveryById(
    @CurrentProject() project: AuthenticatedProject,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeliveryDetailResponseDto> {
    return this.deliveriesService.getDeliveryById(project.id, id);
  }
}
