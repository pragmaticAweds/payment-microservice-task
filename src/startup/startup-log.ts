import { API_BASE_PATH } from '../api.constants';

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
