import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsInt, Min } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';

interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
}

class TestRequestDto {
  @IsInt()
  @Min(1)
  amount!: number;
}

@Controller('test-errors')
class TestErrorsController {
  @Get('unexpected')
  throwUnexpectedError(): never {
    throw new Error('database password must never reach the client');
  }

  @Post('validation')
  validateRequest(@Body() body: TestRequestDto): TestRequestDto {
    return body;
  }
}

describe('Global error handling (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestErrorsController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  it('returns the standard envelope for expected HTTP errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);
    const body = response.body as ErrorResponseBody;

    expect(body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/v1/does-not-exist',
      requestId: response.headers['x-request-id'],
      timestamp: body.timestamp,
      path: '/api/v1/does-not-exist',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('does not expose unexpected-error details to clients', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/test-errors/unexpected')
      .expect(500);
    const body = response.body as ErrorResponseBody;

    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId: response.headers['x-request-id'],
      timestamp: body.timestamp,
      path: '/api/v1/test-errors/unexpected',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(JSON.stringify(body)).not.toContain('database password');
  });

  it('rejects invalid and unknown DTO properties consistently', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/test-errors/validation')
      .send({ amount: 0, extra: 'not allowed' })
      .expect(400);
    const body = response.body as ErrorResponseBody;

    expect(body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      requestId: response.headers['x-request-id'],
      path: '/api/v1/test-errors/validation',
    });
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details).toContain('property extra should not exist');
    expect(body.details).toContain('amount must not be less than 1');
  });

  afterAll(async () => {
    await app.close();
  });
});
