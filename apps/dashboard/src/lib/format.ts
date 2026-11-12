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
