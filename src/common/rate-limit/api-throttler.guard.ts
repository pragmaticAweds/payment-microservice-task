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
    void context;
    void throttlerLimitDetail;

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
