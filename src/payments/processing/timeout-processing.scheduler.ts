import { Injectable } from '@nestjs/common';
import type {
  ProcessingScheduler,
  ScheduledProcessingTask,
} from './payment-processing.types';

@Injectable()
export class TimeoutProcessingScheduler implements ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask {
    const timeout = setTimeout(task, delayMs);
    return { cancel: () => clearTimeout(timeout) };
  }
}
