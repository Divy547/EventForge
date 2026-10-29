import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { EventsService } from './events.service.js';
import { IngestEventDto } from './dto/ingest-event.dto.js';
import { ListEventsQueryDto } from './dto/list-events-query.dto.js';
import {
  IngestEventResponseDto,
  EventDetailResponseDto,
  PaginatedEventsResponseDto,
} from './dto/event-response.dto.js';
import { CurrentProject } from '../../common/decorators/current-project.decorator.js';
import type { AuthenticatedProject } from '../../common/guards/api-key.guard.js';

@ApiTags('Events')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest business event',
    description:
      'Atomically persists an incoming event and enqueues it into the transactional outbox. Returns 202 Accepted.',
  })
  @ApiResponse({
    status: 202,
    description: 'Event durably accepted for processing',
    type: IngestEventResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 413, description: 'Payload too large (> 256 KB)' })
  async ingestEvent(
    @CurrentProject() project: AuthenticatedProject,
    @Body() dto: IngestEventDto,
  ): Promise<IngestEventResponseDto> {
    return this.eventsService.ingestEvent(project.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve event by ID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({
    status: 200,
    description: 'Event details',
    type: EventDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Event not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async getEventById(
    @CurrentProject() project: AuthenticatedProject,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventDetailResponseDto> {
    return this.eventsService.getEventById(project.id, id);
  }

  @Get()
  @ApiOperation({ summary: 'List project events with pagination and filters' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of events',
    type: PaginatedEventsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async listEvents(
    @CurrentProject() project: AuthenticatedProject,
    @Query() query: ListEventsQueryDto,
  ): Promise<PaginatedEventsResponseDto> {
    return this.eventsService.listEvents(project.id, query);
  }
}
