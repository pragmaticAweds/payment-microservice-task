import type { z } from 'zod';
import type { environmentSchema } from './environment.schema';

export type Environment = z.infer<typeof environmentSchema>;
