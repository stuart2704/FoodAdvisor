export function dueSlotToday(timeOfDay: string, now: Date): Date | null {
  const day = now.toISOString().slice(0, 10);
  const slot = new Date(`${day}T${timeOfDay}:00.000Z`);
  return Number.isFinite(slot.getTime()) && slot <= now && slot.toISOString().slice(0, 10) === day
    ? slot : null;
}

export function assignedToday(lastAssignedAt: Date | null, now: Date): boolean {
  return lastAssignedAt?.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

export function utcDayStart(now: Date): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function missedUtcDay(scheduledFor: Date, now: Date): boolean {
  return scheduledFor < utcDayStart(now);
}