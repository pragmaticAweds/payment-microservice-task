import { PinoLogger } from 'nestjs-pino';
import { API_BASE_PATH } from '../api.constants';

export interface StartupApplication {
  listen(port: number): Promise<unknown>;
  resolve(token: typeof PinoLogger): Promise<PinoLogger>;
}

export interface StartupLogContext {
  event: 'service.started';
  port: number;
  apiUrl: string;
}

export function createStartupLogContext(port: number): StartupLogContext {
  return {
    event: 'service.started',
    port,
    apiUrl: `http://localhost:${port}/${API_BASE_PATH}`,
  };
}

export async function listenAndLogStartup(
  app: StartupApplication,
  port: number,
): Promise<void> {
  await app.listen(port);
  const logger = await app.resolve(PinoLogger);

  logger.info(createStartupLogContext(port), 'Payment service listening');
}
