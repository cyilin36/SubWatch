import {
  addCycle,
  DEFAULT_EXPIRY_TIME,
  todayInZone,
  type Cycle,
  type SubscriptionDto,
  type SubscriptionInput,
} from '@subwatch/shared';

/**
 * Editable subscription form values. Every field is present (no zod defaults
 * here) so the form inputs stay controlled; `subscriptionInputSchema` is applied
 * to the values right before submitting.
 */
export interface SubscriptionFormValues {
  name: string;
  url: string;
  expiryDate: string;
  expiryTime: string;
  cycle: Cycle;
  reminderOffsets: number[];
  channelIds: string[];
  notes: string;
  paused: boolean;
}

/** Default values for a brand-new subscription: today + one month, settings offsets. */
export function blankSubscriptionFormValues(
  timezone: string,
  defaultReminderOffsets: number[],
): SubscriptionFormValues {
  return {
    name: '',
    url: '',
    expiryDate: addCycle(todayInZone(timezone), 'month'),
    expiryTime: DEFAULT_EXPIRY_TIME,
    cycle: 'month',
    reminderOffsets: [...defaultReminderOffsets],
    channelIds: [],
    notes: '',
    paused: false,
  };
}

/** Map an existing subscription DTO to editable form values. */
export function subscriptionToFormValues(subscription: SubscriptionDto): SubscriptionFormValues {
  return {
    name: subscription.name,
    url: subscription.url ?? '',
    expiryDate: subscription.expiryDate,
    expiryTime: subscription.expiryTime,
    cycle: subscription.cycle,
    reminderOffsets: [...subscription.reminderOffsets],
    channelIds: [...subscription.channelIds],
    notes: subscription.notes,
    paused: subscription.paused,
  };
}

/** Normalize form values into the API input shape (PUT requires the whole object). */
export function subscriptionFormToInput(values: SubscriptionFormValues): SubscriptionInput {
  return {
    name: values.name,
    url: values.url.trim(),
    expiryDate: values.expiryDate,
    expiryTime: values.expiryTime,
    cycle: values.cycle,
    reminderOffsets: [...values.reminderOffsets],
    channelIds: [...values.channelIds],
    notes: values.notes,
    paused: values.paused,
  };
}

/**
 * Next expiry date for one-click renewal: add one cycle to
 * max(today, current expiry), matching the server-side fallback.
 */
export function nextExpiryDate(expiryDate: string, cycle: Cycle, timezone: string): string {
  const today = todayInZone(timezone);
  const base = expiryDate && expiryDate > today ? expiryDate : today;
  return addCycle(base, cycle);
}
