import type { PinoLogger } from 'nestjs-pino';
import { STARTUP_EVENT } from './startup.constants';

export interface StartupApplication {
  listen(port: number): Promise<unknown>;
  resolve(token: typeof PinoLogger): Promise<PinoLogger>;
}

export interface StartupLogContext {
  event: typeof STARTUP_EVENT;
  port: number;
  apiUrl: string;
}
