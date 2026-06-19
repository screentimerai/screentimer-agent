// Shared helpers for the billing-tag commands (tag / untag / tags / billing).

/**
 * Resolve [start, end] from --start/--end ISO flags, or --days N as a
 * convenience (last N days; 1 = today since local midnight). Unlike the
 * `time` command, billing defaults to NO window (all-time) when nothing is
 * passed — you usually tag a deliberate range, and bill a whole label.
 */
export function resolveBillingWindow(args: any): {
  start?: string;
  end?: string;
  windowLabel: string;
} {
  if (args.start || args.end) {
    const windowLabel =
      args.start && args.end
        ? `${args.start} → ${args.end}`
        : args.start
          ? `since ${args.start}`
          : `until ${args.end}`;
    return { start: args.start, end: args.end, windowLabel };
  }

  if (typeof args.days === 'number' && args.days > 0) {
    const days = Math.floor(args.days);
    const startDate = new Date();
    if (days === 1) {
      startDate.setHours(0, 0, 0, 0);
      return { start: startDate.toISOString(), windowLabel: 'today' };
    }
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    return { start: startDate.toISOString(), windowLabel: `last ${days} days` };
  }

  return { windowLabel: 'all time' };
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Decimal hours rounded to a billing increment (in minutes). 0 = no rounding. */
export function billableHours(seconds: number, roundMinutes: number): number {
  const hours = seconds / 3600;
  if (!roundMinutes || roundMinutes <= 0) {
    return Math.round(hours * 100) / 100;
  }
  const increment = roundMinutes / 60;
  return Math.round((Math.ceil(hours / increment) * increment) * 100) / 100;
}
