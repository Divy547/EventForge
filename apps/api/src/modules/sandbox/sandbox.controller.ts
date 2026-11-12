import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Body,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SANDBOX_PROJECT_SLUG } from '@eventforge/common';
import { validateEnv } from '@eventforge/config';
import { SandboxService } from './sandbox.service.js';
import { SandboxRateLimiter } from './sandbox-rate-limiter.js';
import {
  SendSandboxEventDto,
  SandboxSessionResponseDto,
  SendSandboxEventResponseDto,
} from './dto/send-sandbox-event.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentProject } from '../../common/decorators/current-project.decorator.js';
import type { AuthenticatedProject } from '../../common/guards/api-key.guard.js';

@ApiTags('Sandbox')
@Controller('v1/sandbox')
export class SandboxController {
  private readonly config = validateEnv();

  constructor(
    private readonly sandbox: SandboxService,
    private readonly limiter: SandboxRateLimiter,
  ) {}

  @Public()
  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a sandbox session',
    description:
      'Public. Returns a short-lived API key for the shared sandbox project so a visitor can try EventForge without an account. Rate limited per client IP. Responds 404 when sandbox mode is off.',
  })
  @ApiResponse({ status: 201, type: SandboxSessionResponseDto })
  @ApiResponse({ status: 404, description: 'Sandbox mode is not enabled' })
  @ApiResponse({ status: 429, description: 'Too many sessions from this address' })
  async createSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SandboxSessionResponseDto> {
    this.sandbox.assertEnabled();
    const verdict = await this.limiter.consume(
      `session:${req.ip ?? 'unknown'}`,
      this.config.SANDBOX_SESSIONS_PER_HOUR,
    );
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      throw new HttpException(
        `Too many sandbox sessions. Retry after ${verdict.retryAfterSeconds} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.sandbox.createSession();
  }

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary: 'Send a sandbox test event',
    description:
      'Sends an event to the built-in demo receiver, which behaves as the chosen scenario. Only keys of the sandbox project may call this.',
  })
  @ApiResponse({ status: 202, type: SendSandboxEventResponseDto })
  @ApiResponse({ status: 403, description: 'The key does not belong to the sandbox project' })
  @ApiResponse({ status: 404, description: 'Sandbox mode is not enabled' })
  @ApiResponse({ status: 429, description: 'Sandbox write limit reached' })
  async sendEvent(
    @CurrentProject() project: AuthenticatedProject,
    @Body() dto: SendSandboxEventDto,
    @Req() req: Request,
  ): Promise<SendSandboxEventResponseDto> {
    this.sandbox.assertEnabled();
    if (project.slug !== SANDBOX_PROJECT_SLUG) {
      throw new ForbiddenException('Sandbox events can only be sent with a sandbox key');
    }
    return this.sandbox.sendEvent(project, dto.scenario, {
      traceparent: req.traceparent,
      tracestate: req.tracestate,
    });
  }
}
