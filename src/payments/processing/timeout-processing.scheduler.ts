import { Injectable } from '@nestjs/common';
import {
  type ProcessingScheduler,
  type ScheduledProcessingTask,
} from './processing-scheduler';

@Injectable()
export class TimeoutProcessingScheduler implements ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask {
    const timeout = setTimeout(task, delayMs);
    return { cancel: () => clearTimeout(timeout) };
  }
}
