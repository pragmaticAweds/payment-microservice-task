import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse<{
      header(name: string, value: number): unknown;
    }>();

    response.header('Retry-After', throttlerLimitDetail.timeToBlockExpire);
    response.header('X-RateLimit-Limit', throttlerLimitDetail.limit);
    response.header(
      'X-RateLimit-Remaining',
      Math.max(0, throttlerLimitDetail.limit - throttlerLimitDetail.totalHits),
    );
    response.header('X-RateLimit-Reset', throttlerLimitDetail.timeToExpire);

    return Promise.reject(
      new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  }
}
