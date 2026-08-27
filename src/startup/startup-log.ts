import { PinoLogger } from 'nestjs-pino';
import { API_BASE_PATH } from '../api.constants';
import { STARTUP_EVENT, STARTUP_LOG_MESSAGE } from './startup.constants';
import type { StartupApplication, StartupLogContext } from './startup.types';

export function createStartupLogContext(port: number): StartupLogContext {
  return {
    event: STARTUP_EVENT,
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

  logger.info(createStartupLogContext(port), STARTUP_LOG_MESSAGE);
}
