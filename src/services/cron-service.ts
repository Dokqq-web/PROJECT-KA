export function nextCronOccurrence(
  expression: string,
  timezone: string,
  after: Date
): Date {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("Cron должен содержать 5 полей: минута час день месяц день-недели");
  }
  validateTimezone(timezone);
  const matchers = [
    parseField(fields[0]!, 0, 59),
    parseField(fields[1]!, 0, 23),
    parseField(fields[2]!, 1, 31),
    parseField(fields[3]!, 1, 12),
    parseField(fields[4]!, 0, 6, true)
  ];
  const candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  const maximum = 366 * 24 * 60;
  for (let index = 0; index < maximum; index += 1) {
    const parts = zonedParts(candidate, timezone);
    if (
      matchers[0]!(parts.minute) &&
      matchers[1]!(parts.hour) &&
      matchers[2]!(parts.day) &&
      matchers[3]!(parts.month) &&
      matchers[4]!(parts.weekday)
    ) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("Cron не имеет срабатываний в течение ближайшего года");
}

function parseField(
  input: string,
  minimum: number,
  maximum: number,
  sundayAlias = false
): (value: number) => boolean {
  const values = new Set<number>();
  for (const part of input.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Некорректный cron: ${input}`);
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = minimum;
      end = maximum;
    } else if (rangePart?.includes("-")) {
      const [left, right] = rangePart.split("-").map(Number);
      start = normalizeCronValue(left!, sundayAlias);
      end = normalizeCronValue(right!, sundayAlias);
    } else {
      start = normalizeCronValue(Number(rangePart), sundayAlias);
      end = start;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < minimum ||
      end > maximum ||
      start > end
    ) {
      throw new Error(`Значение cron вне диапазона: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return (value) => values.has(value);
}

function normalizeCronValue(value: number, sundayAlias: boolean): number {
  return sundayAlias && value === 7 ? 0 : value;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Неизвестный часовой пояс: ${timezone}`);
  }
}

function zonedParts(date: Date, timezone: string): {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    day: "2-digit",
    month: "2-digit",
    weekday: "short"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
  };
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdays[parts.weekday!]!
  };
}
