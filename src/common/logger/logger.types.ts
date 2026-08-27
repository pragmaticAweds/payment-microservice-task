export interface LoggerEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  SERVICE_NAME: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}
