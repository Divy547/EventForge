import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { StatsService } from './stats.service.js';
import { StatsQueryDto } from './dto/stats-query.dto.js';
import { StatsResponseDto } from './dto/stats-response.dto.js';
import { CurrentProject } from '../../common/decorators/current-project.decorator.js';
import type { AuthenticatedProject } from '../../common/guards/api-key.guard.js';

@ApiTags('Stats')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @ApiOperation({
    summary: 'Delivery health summary',
    description:
      'Delivery counts by status, success rate and the most recent failures for the authenticated project over a look-back window.',
  })
  @ApiResponse({ status: 200, description: 'Stats summary', type: StatsResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async getStats(
    @CurrentProject() project: AuthenticatedProject,
    @Query() query: StatsQueryDto,
  ): Promise<StatsResponseDto> {
    return this.statsService.getStats(project.id, query.windowHours);
  }
}
