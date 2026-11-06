import { parseJson } from '../db/helpers.js';

/** Decode the JSON `reminder_offsets` column into a usable number list. */
export function parseReminderOffsets(raw: string): number[] {
  const values = parseJson<unknown>(raw, []);
  if (!Array.isArray(values)) return [];
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  );
}

/** Decode the JSON `channel_ids` column into a usable id list. */
export function parseChannelIds(raw: string): string[] {
  const values = parseJson<unknown>(raw, []);
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
