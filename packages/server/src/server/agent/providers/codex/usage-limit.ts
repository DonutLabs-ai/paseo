const CODEX_USAGE_LIMIT_ERROR_PATTERN =
  /^(?:\[System Error\] )?(?:Error running remote compact task: )?You've hit your usage limit\. (?:Upgrade to Pro \(https:\/\/chatgpt\.com\/explore\/pro\), visit|Visit) https:\/\/chatgpt\.com\/codex\/settings\/usage to purchase more credits or try again at (.+)\.$/;
const CODEX_USAGE_LIMIT_DATE_PATTERN =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})(?:st|nd|rd|th), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/;
const CODEX_USAGE_LIMIT_TIME_PATTERN = /^(\d{1,2}):(\d{2}) (AM|PM)$/;
const CODEX_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseDatedReset(
  match: RegExpMatchArray,
  hour24: number,
  minute: number,
  now: Date,
): string | null {
  const month = CODEX_MONTHS.indexOf(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const retryAt = new Date(year, month, day, hour24, minute);
  if (
    retryAt.getFullYear() !== year ||
    retryAt.getMonth() !== month ||
    retryAt.getDate() !== day ||
    retryAt.getHours() !== hour24 ||
    retryAt.getMinutes() !== minute ||
    retryAt.getTime() <= now.getTime()
  ) {
    return null;
  }
  return retryAt.toISOString();
}

export function parseCodexUsageLimitRetryAt(
  message: string,
  options?: { requireDate?: boolean },
): string | null {
  const match = message.trim().replaceAll("’", "'").match(CODEX_USAGE_LIMIT_ERROR_PATTERN);
  if (!match) return null;
  const resetTime = match[1];
  const dated = resetTime.match(CODEX_USAGE_LIMIT_DATE_PATTERN);
  const timed = dated ?? resetTime.match(CODEX_USAGE_LIMIT_TIME_PATTERN);
  if (!timed || (options?.requireDate && !dated)) return null;

  const hour = Number(dated ? timed[4] : timed[1]);
  const minute = Number(dated ? timed[5] : timed[2]);
  const meridiem = dated ? timed[6] : timed[3];
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const hour24 = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  const now = new Date();
  if (!dated) {
    const retryAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour24, minute);
    if (retryAt.getTime() <= now.getTime()) retryAt.setDate(retryAt.getDate() + 1);
    return retryAt.toISOString();
  }

  return parseDatedReset(timed, hour24, minute, now);
}
