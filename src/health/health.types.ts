export type HealthDependencyStatus = 'ready' | 'not_ready';

export interface HealthReadinessChecks {
  repository: HealthDependencyStatus;
  processor: HealthDependencyStatus;
}

export interface HealthReadinessData {
  status: 'ready';
  checks: HealthReadinessChecks;
}
