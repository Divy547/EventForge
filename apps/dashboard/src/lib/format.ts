const number = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return number.format(value);
}

/** 0.9876 -> "98.8%"; null (nothing finished yet) -> an en dash. */
export function formatPercent(fraction: number | null): string {
  if (fraction === null) return '–';
  return `${(Math.floor(fraction * 1000) / 10).toFixed(1)}%`;
}

export function formatWindow(hours: number): string {
  if (hours < 24) return `${hours} h`;
  return `${hours / 24} d`;
}

/** "5 min ago", "3 h ago", "2 d ago". Coarse on purpose; the exact time is in the title attribute. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "2026-11-12T11:55:00.000Z" -> the visitor's local date and time. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** First eight characters of a UUID: enough to tell rows apart, the full ID is on the detail page. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

function parseLocalDay(day: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T${time}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** "2026-11-12" (a date input's value) -> the ISO instant that local day starts. Bad input -> undefined. */
export function startOfDayIso(day: string): string | undefined {
  return parseLocalDay(day, '00:00:00.000');
}

/** Same, for the last millisecond of the local day, so a "to" date includes that whole day. */
export function endOfDayIso(day: string): string | undefined {
  return parseLocalDay(day, '23:59:59.999');
}
