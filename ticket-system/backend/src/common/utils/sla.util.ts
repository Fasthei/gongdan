export type CustomerTier = 'NORMAL' | 'KEY' | 'EXCLUSIVE';

export interface SlaConfig {
  firstResponseHours: number;
  resolutionHours: number;
  queueType: 'PUBLIC' | 'PRIORITY' | 'DEDICATED';
}

export const SLA_CONFIG: Record<CustomerTier, SlaConfig> = {
  EXCLUSIVE: { firstResponseHours: 1, resolutionHours: 12, queueType: 'DEDICATED' },
  KEY:       { firstResponseHours: 4, resolutionHours: 24, queueType: 'PRIORITY' },
  NORMAL:    { firstResponseHours: 24, resolutionHours: 72, queueType: 'PUBLIC' },
};

export function calculateSlaDeadline(tier: CustomerTier, createdAt: Date): Date {
  const config = SLA_CONFIG[tier];
  const deadline = new Date(createdAt.getTime());
  deadline.setHours(deadline.getHours() + config.resolutionHours);
  return deadline;
}

export function getSlaConfig(tier: CustomerTier): SlaConfig {
  return SLA_CONFIG[tier];
}
