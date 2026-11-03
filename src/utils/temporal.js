import { ValidationError } from '../errors/index.js';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[Tt ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/i;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;
const TOKEN_SPECS = [
  ['YYYY', 'year', '\\d{4}'], ['MMMM', 'monthName', '[A-Za-z]+'], ['MMM', 'monthShort', '[A-Za-z]{3}'],
  ['SSS', 'millisecond', '\\d{1,3}'], ['MM', 'month', '\\d{1,2}'], ['M', 'month', '\\d{1,2}'],
  ['DD', 'day', '\\d{1,2}'], ['D', 'day', '\\d{1,2}'], ['HH', 'hour24', '\\d{1,2}'], ['H', 'hour24', '\\d{1,2}'],
  ['hh', 'hour12', '\\d{1,2}'], ['h', 'hour12', '\\d{1,2}'], ['mm', 'minute', '\\d{1,2}'], ['m', 'minute', '\\d{1,2}'],
  ['ss', 'second', '\\d{1,2}'], ['s', 'second', '\\d{1,2}'], ['A', 'ampm', '[AaPp][Mm]'], ['a', 'ampm', '[AaPp][Mm]'],
  ['Z', 'zone', '(?:Z|[+-](?:[01]\\d|2[0-3]):?[0-5]\\d)']
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORMAT_CACHE = new Map();
const DAY_MS = 86_400_000;

export function inferTemporalType(values) {
  const present = values.filter(value => value !== null && value !== undefined);
  if (!present.length || !present.every(value => typeof value === 'string')) return null;
  if (present.every(value => DATE_ONLY_RE.test(value))) return 'date';
  if (present.every(value => DATETIME_RE.test(value))) return 'datetime';
  if (present.every(value => TIME_RE.test(value))) return 'time';
  return null;
}

export function validateTemporalFormat(format, type) {
  if (format === undefined) return;
  compileFormat(format, type);
}

export function castTemporal(value, type, format) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('Invalid Date');
    if (type === 'date') return new Date(value);
    if (type === 'datetime') return value.toISOString();
    return canonicalTime(value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds());
  }
  if (typeof value !== 'string') throw new RangeError('Expected a temporal string.');
  const text = value.trim();
  if (format !== undefined) {
    const parts = parseWithFormat(text, format, type);
    return makeTemporal(parts, type);
  }
  if (type === 'date') {
    if (!DATE_ONLY_RE.test(text)) {
      if (!DATETIME_RE.test(text)) throw new RangeError('Expected an ISO date such as 2026-11-03.');
      const parsed = parseIsoDateTime(text);
      return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
    }
    const parts = text.split('-').map(Number);
    return makeTemporal({ year: parts[0], month: parts[1], day: parts[2] }, 'date');
  }
  if (type === 'datetime') {
    if (!DATETIME_RE.test(text)) throw new RangeError('Expected an ISO datetime such as 2026-11-03T14:30:00Z.');
    return parseIsoDateTime(text).toISOString();
  }
  if (type === 'time') {
    if (!TIME_RE.test(text)) throw new RangeError('Expected an ISO time such as 14:30:00.');
    const [clock, fraction = ''] = text.split('.');
    const [hour, minute, second = '0'] = clock.split(':').map(Number);
    return canonicalTime(hour, minute, Number(second), Number(fraction.padEnd(3, '0')));
  }
  throw new ValidationError(`Unsupported temporal type: ${type}`);
}

export function extractDatePart(value, part, options = {}) {
  const date = value instanceof Date ? new Date(value) : parseIsoDateForExtraction(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date value.');
  const nameLength = options.nameLength ?? 'long';
  if (!['short', 'long'].includes(nameLength)) throw new ValidationError("nameLength must be 'short' or 'long'.");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  switch (part) {
    case 'day': return day;
    case 'weekday': return (nameLength === 'short' ? WEEKDAYS_SHORT : WEEKDAYS)[date.getUTCDay()];
    case 'week': return isoWeek(date);
    case 'month': return month;
    case 'monthName': return (nameLength === 'short' ? MONTHS_SHORT : MONTHS)[month - 1];
    case 'quarter': return Math.ceil(month / 3);
    case 'year': return year;
    default: throw new ValidationError(`Unsupported date part "${part}". Choose day, weekday, week, month, monthName, quarter, or year.`);
  }
}

function compileFormat(format, type) {
  if (typeof format !== 'string' || !format.length) throw new ValidationError('Temporal format must be a non-empty string.');
  const cacheKey = `${type}\u0000${format}`;
  if (FORMAT_CACHE.has(cacheKey)) return FORMAT_CACHE.get(cacheKey);
  let source = '^';
  const groups = [];
  for (let index = 0; index < format.length;) {
    const spec = TOKEN_SPECS.find(([token]) => format.startsWith(token, index));
    if (spec) {
      source += `(${spec[2]})`;
      groups.push({ field: spec[1], token: spec[0] });
      index += spec[0].length;
    } else {
      source += escapeRegExp(format[index]);
      index += 1;
    }
  }
  source += '$';
  const has = field => groups.some(group => group.field === field);
  const hasDate = has('year') && (has('month') || has('monthName') || has('monthShort')) && has('day');
  const hasHour = has('hour24') || has('hour12');
  const hasClock = hasHour && has('minute');
  const hasTimeToken = hasHour || has('minute') || has('second') || has('millisecond') || has('ampm') || has('zone');
  if (type === 'date' && (!hasDate || hasTimeToken)) throw new ValidationError('A date format must contain year, month, and day tokens only.');
  if (type === 'datetime' && (!hasDate || !hasClock)) throw new ValidationError('A datetime format must contain year, month, day, hour, and minute tokens.');
  if (type === 'time' && (hasDate || !hasClock || has('zone'))) throw new ValidationError('A time format must contain hour and minute tokens and no date or timezone tokens.');
  if (has('hour12') && !has('ampm')) throw new ValidationError('A 12-hour format must include an AM/PM token.');
  if (has('hour24') && has('ampm')) throw new ValidationError('Use either a 24-hour token or an AM/PM token, not both.');
  const parser = { regex: new RegExp(source, 'i'), groups };
  FORMAT_CACHE.set(cacheKey, parser);
  return parser;
}

function parseWithFormat(text, format, type) {
  const parser = compileFormat(format, type);
  const match = parser.regex.exec(text);
  if (!match) throw new RangeError('Value does not match the supplied temporal format.');
  const parts = {};
  parser.groups.forEach(({ field }, index) => { parts[field] = match[index + 1]; });
  if (parts.monthName) parts.month = monthNumber(parts.monthName, false);
  if (parts.monthShort) parts.month = monthNumber(parts.monthShort, true);
  for (const field of ['year', 'month', 'day', 'hour24', 'hour12', 'minute', 'second', 'millisecond']) {
    if (parts[field] !== undefined && field !== 'monthName' && field !== 'monthShort') parts[field] = Number(parts[field]);
  }
  if (parts.hour12 !== undefined) {
    if (parts.hour12 < 1 || parts.hour12 > 12) throw new RangeError('12-hour clock hour must be 1..12.');
    parts.hour24 = (parts.hour12 % 12) + (/^pm$/i.test(parts.ampm) ? 12 : 0);
  }
  parts.zoneOffset = parts.zone ? parseOffset(parts.zone) : 0;
  return parts;
}

function makeTemporal(parts, type) {
  if (type === 'time') {
    const hour = parts.hour24 ?? 0;
    const minute = parts.minute ?? 0;
    const second = parts.second ?? 0;
    const millisecond = parts.millisecond ?? 0;
    validateClock(hour, minute, second, millisecond);
    return canonicalTime(hour, minute, second, millisecond);
  }
  const { year, month, day } = parts;
  const hour = type === 'datetime' ? (parts.hour24 ?? 0) : 0;
  const minute = type === 'datetime' ? (parts.minute ?? 0) : 0;
  const second = type === 'datetime' ? (parts.second ?? 0) : 0;
  const millisecond = type === 'datetime' ? (parts.millisecond ?? 0) : 0;
  validateClock(hour, minute, second, millisecond);
  const date = makeUTCDate(year, month, day, hour, minute, second, millisecond);
  if (type === 'date') return date;
  date.setTime(date.getTime() - (parts.zoneOffset ?? 0) * 60_000);
  return date.toISOString();
}

function parseIsoDateTime(text) {
  const normalized = text.replace(' ', 'T');
  const datePart = normalized.slice(0, 10);
  const dateNumbers = datePart.split('-').map(Number);
  makeUTCDate(dateNumbers[0], dateNumbers[1], dateNumbers[2]);
  let parseText = normalized;
  if (!/(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i.test(normalized)) parseText += 'Z';
  const date = new Date(parseText);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid ISO datetime.');
  return date;
}

function parseIsoDateForExtraction(value) {
  if (typeof value !== 'string') throw new RangeError('Expected a date or datetime string.');
  const text = value.trim();
  if (DATE_ONLY_RE.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return makeUTCDate(year, month, day);
  }
  if (DATETIME_RE.test(text)) return parseIsoDateTime(text);
  throw new RangeError('Expected an ISO date or datetime string.');
}

function makeUTCDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1 || day > 31) throw new RangeError('Invalid calendar date.');
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new RangeError('Invalid calendar date.');
  return date;
}

function validateClock(hour, minute, second, millisecond) {
  if (![hour, minute, second, millisecond].every(Number.isInteger) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) {
    throw new RangeError('Invalid clock time.');
  }
}

function canonicalTime(hour, minute, second, millisecond) {
  validateClock(hour, minute, second, millisecond);
  return `${pad(hour)}:${pad(minute)}:${pad(second)}.${String(millisecond).padStart(3, '0')}`;
}
function pad(value) { return String(value).padStart(2, '0'); }
function parseOffset(value) {
  if (/^Z$/i.test(value)) return 0;
  const sign = value[0] === '-' ? -1 : 1;
  const digits = value.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  if (hours > 23 || minutes > 59) throw new RangeError('Invalid timezone offset.');
  return sign * (hours * 60 + minutes);
}
function monthNumber(value, short) {
  const index = MONTHS.findIndex(month => (short ? month.slice(0, 3) : month).toLowerCase() === value.toLowerCase());
  if (index < 0) throw new RangeError(`Unknown month name: ${value}`);
  return index + 1;
}
function isoWeek(inputDate) {
  const date = new Date(Date.UTC(inputDate.getUTCFullYear(), inputDate.getUTCMonth(), inputDate.getUTCDate()));
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / DAY_MS + 1) / 7);
}
function escapeRegExp(character) { return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
