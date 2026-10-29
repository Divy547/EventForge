import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import {
  SubscriptionResponseDto,
  CreatedSubscriptionResponseDto,
} from './dto/subscription-response.dto.js';
import { CurrentProject } from '../../common/decorators/current-project.decorator.js';
import type { AuthenticatedProject } from '../../common/guards/api-key.guard.js';

@ApiTags('Subscriptions')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register webhook subscription',
    description:
      'Creates a new webhook destination with SSRF verification and returns a generated HMAC-SHA256 signing secret.',
  })
  @ApiResponse({
    status: 201,
    description: 'Subscription created (signing secret shown once)',
    type: CreatedSubscriptionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed or SSRF protection triggered' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async createSubscription(
    @CurrentProject() project: AuthenticatedProject,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<CreatedSubscriptionResponseDto> {
    return this.subscriptionsService.createSubscription(project.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List project webhook subscriptions' })
  @ApiResponse({
    status: 200,
    description: 'List of subscriptions (secrets omitted)',
    type: [SubscriptionResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async listSubscriptions(
    @CurrentProject() project: AuthenticatedProject,
  ): Promise<SubscriptionResponseDto[]> {
    return this.subscriptionsService.listSubscriptions(project.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve subscription by ID' })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription details (secret omitted)',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async getSubscriptionById(
    @CurrentProject() project: AuthenticatedProject,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.getSubscriptionById(project.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update subscription configuration' })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({
    status: 200,
    description: 'Updated subscription',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed or SSRF triggered' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async updateSubscription(
    @CurrentProject() project: AuthenticatedProject,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.updateSubscription(project.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete webhook subscription' })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({ status: 204, description: 'Subscription deleted' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async deleteSubscription(
    @CurrentProject() project: AuthenticatedProject,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.subscriptionsService.deleteSubscription(project.id, id);
  }
}
