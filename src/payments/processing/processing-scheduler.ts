export const PROCESSING_SCHEDULER = Symbol('PROCESSING_SCHEDULER');

export interface ScheduledProcessingTask {
  cancel(): void;
}

export interface ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask;
}
