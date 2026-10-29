import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedProject } from '../guards/api-key.guard.js';

export const CurrentProject = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedProject => {
    const request = ctx.switchToHttp().getRequest();
    return request.project;
  },
);
