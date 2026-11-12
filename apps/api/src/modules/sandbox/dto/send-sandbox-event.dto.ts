import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SANDBOX_SCENARIOS, type SandboxScenario } from '@eventforge/common';

export class SendSandboxEventDto {
  @ApiProperty({
    enum: SANDBOX_SCENARIOS,
    example: 'flaky',
    description: 'How the built-in demo receiver behaves for this event',
  })
  @IsIn(SANDBOX_SCENARIOS)
  scenario!: SandboxScenario;
}

export class SandboxSessionResponseDto {
  @ApiProperty({ description: 'A project API key for the sandbox project (shown once)' })
  apiKey!: string;

  @ApiProperty({ description: 'When the key stops working (ISO 8601)' })
  expiresAt!: string;
}

export class SendSandboxEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ enum: SANDBOX_SCENARIOS })
  scenario!: SandboxScenario;

  @ApiProperty({ example: 'sandbox.flaky' })
  eventType!: string;
}
