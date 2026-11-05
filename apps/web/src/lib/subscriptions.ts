import type { SubscriptionDto, SubscriptionInput } from '@subwatch/shared';

/**
 * Build a full subscription input payload from a DTO. The API requires the whole
 * input schema on PUT; `fields` may contain SECRET_KEEP sentinels for masked
 * secrets, which the server resolves back to the stored values.
 */
export function subscriptionInputFromDto(dto: SubscriptionDto): SubscriptionInput {
  return {
    name: dto.name,
    templateId: dto.templateId,
    fields: dto.fields as SubscriptionInput['fields'],
    startDate: dto.startDate,
    expiryDate: dto.expiryDate,
    cycle: dto.cycle,
    cycleDays: dto.cycleDays,
    amountCents: dto.amountCents,
    currency: dto.currency,
    reminderOffsets: [...dto.reminderOffsets],
    channelIds: [...dto.channelIds],
    linkedMonitorIds: [...dto.linkedMonitorIds],
    notes: dto.notes,
    paused: dto.paused,
    archived: dto.archived,
  };
}
