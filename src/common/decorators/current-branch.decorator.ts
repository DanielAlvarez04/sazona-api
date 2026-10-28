import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Sucursal activa resuelta por `BranchContextInterceptor`.
 *
 * Devuelve `null` cuando la petición opera sobre toda la organización.
 */
export const CurrentBranch = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const request = context.switchToHttp().getRequest<{ branchId?: string | null }>();
    return request.branchId ?? null;
  },
);
