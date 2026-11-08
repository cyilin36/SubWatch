import {
  daysLeft,
  isExpiredAt,
  type GeneralSettings,
  type SubscriptionStatus,
} from '@subwatch/shared';

/**
 * Subscription state needed to build or refresh its reminder schedule.
 * There is no archive concept anymore: paused subscriptions are the only ones
 * whose pending reminder rows are dropped.
 */
export interface SubscriptionReminderState {
  subscriptionId: string;
  expiryDate: string;
  expiryTime: string;
  reminderOffsets: number[];
  paused: boolean;
}

/** Reminder offsets actually used: subscription overrides, otherwise settings default. */
export function resolveEffectiveOffsets(subscriptionOffsets: number[], general: GeneralSettings): number[] {
  const source = subscriptionOffsets.length > 0 ? subscriptionOffsets : general.defaultReminderOffsets;
  const unique = new Set<number>();
  for (const value of source) {
    if (Number.isInteger(value) && value >= 0 && value <= 3650) unique.add(value);
  }
  return [...unique].sort((a, b) => a - b);
}

/** expiring = within the reminder window (at least 7 days) and not yet expired. */
export function deriveSubscriptionStatus(
  state: { paused: boolean; expiryDate: string; expiryTime: string; reminderOffsets: number[] },
  general: GeneralSettings,
  timezone: string,
): SubscriptionStatus {
  if (state.paused) return 'paused';
  // The exact wall-clock expiry (to the minute) decides when it becomes expired.
  if (isExpiredAt(state.expiryDate, state.expiryTime, timezone)) return 'expired';
  const remaining = daysLeft(state.expiryDate, timezone);
  const offsets = resolveEffectiveOffsets(state.reminderOffsets, general);
  const window = Math.max(7, ...(offsets.length > 0 ? offsets : [0]));
  return remaining <= window ? 'expiring' : 'active';
}
