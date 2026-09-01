export interface MessageTimestampPresentation {
  dateTime: string;
  displayLabel: string;
  fullLabel: string;
}

export function messageTimestampPresentation(
  occurredAt: string,
  options: { locale?: string; now?: Date; timeZone?: string } = {},
): MessageTimestampPresentation | null {
  const date = new Date(occurredAt);
  const now = options.now ?? new Date();
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) {
    return null;
  }

  const timeZoneOptions = options.timeZone
    ? { timeZone: options.timeZone }
    : {};
  const calendarParts = (
    value: Date,
  ): {
    day: number;
    month: number;
    year: number;
  } => {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...timeZoneOptions,
    }).formatToParts(value);
    const numericPart = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value);
    return {
      day: numericPart("day"),
      month: numericPart("month"),
      year: numericPart("year"),
    };
  };
  const occurredParts = calendarParts(date);
  const nowParts = calendarParts(now);
  const dayNumber = ({ day, month, year }: typeof occurredParts): number =>
    Date.UTC(year, month - 1, day) / 86_400_000;
  const occurredDay = dayNumber(occurredParts);
  const currentDay = dayNumber(nowParts);
  const currentWeekday =
    (new Date(currentDay * 86_400_000).getUTCDay() + 6) % 7;
  const currentWeekStart = currentDay - currentWeekday;
  const timeLabel = new Intl.DateTimeFormat(options.locale, {
    hour: "numeric",
    minute: "2-digit",
    ...timeZoneOptions,
  }).format(date);

  let displayLabel: string;
  if (occurredDay === currentDay) {
    displayLabel = timeLabel;
  } else if (occurredDay >= currentWeekStart && occurredDay < currentDay) {
    const weekday = new Intl.DateTimeFormat(options.locale, {
      weekday: "long",
      ...timeZoneOptions,
    }).format(date);
    displayLabel = `${weekday} ${timeLabel}`;
  } else if (occurredParts.year === nowParts.year) {
    const month = new Intl.DateTimeFormat(options.locale, {
      month: "short",
      ...timeZoneOptions,
    }).format(date);
    displayLabel = `${month}, ${String(occurredParts.day).padStart(2, "0")} ${timeLabel}`;
  } else {
    displayLabel = `${String(occurredParts.month).padStart(2, "0")}/${String(occurredParts.day).padStart(2, "0")}/${String(occurredParts.year).slice(-2)} ${timeLabel}`;
  }

  return {
    dateTime: date.toISOString(),
    displayLabel,
    fullLabel: new Intl.DateTimeFormat(options.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      ...timeZoneOptions,
    }).format(date),
  };
}
