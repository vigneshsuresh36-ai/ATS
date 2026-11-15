export type TimeRange = { start: string; end: string };
export function isFreeInterval(slot: TimeRange, busy: TimeRange[]): boolean {
  const start = Date.parse(slot.start), end = Date.parse(slot.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  return busy.every((period) => {
    const busyStart = Date.parse(period.start), busyEnd = Date.parse(period.end);
    return Number.isFinite(busyStart) && Number.isFinite(busyEnd) && busyEnd > busyStart && (end <= busyStart || start >= busyEnd);
  });
}
