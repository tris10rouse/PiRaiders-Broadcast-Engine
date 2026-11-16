'use strict';
// Detached timing metadata checks only. Never a confirmed window or arming authority.
const {canonicalExchangeJSON} = require('./exchange-fingerprints.cjs');
const {createExchangeProblemStateGate} = require('./exchange-problem-state.cjs');
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const RULES = Object.freeze(['V13', 'V19-instant-calendar-order', 'V19-broadcast-window-duration']);
const PENDING = Object.freeze(['asset-bytes', 'durable-ledger', 'eligibility-admission', 'descriptor-context', 'operator-confirmation']);
const CODES = new Set(['TIMING_INPUT_INVALID', 'TIMING_PREREQUISITE_INVALID', 'TIMING_CALENDAR_INVALID',
  'TIMING_INSTANT_INVALID', 'TIMING_INTERVAL_INVALID', 'TIMING_BACKEND_UNAVAILABLE']);
const INSTANT = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(-05:00|-06:00)$/;
function fail(code) { throw Error(code); }
function calendar(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function validDate(value) {
  const match = /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
  return !!match && calendar(...match.slice(1).map(Number));
}
function wallEpoch(parts) {
  // Date.UTC maps years0..99 into1900..1999. This construction does not.
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(parts[3], parts[4], parts[5], 0);
  return date.getTime();
}
function createFormatter() {
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone: 'America/Chicago', calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    const options = formatter.resolvedOptions();
    if (options.timeZone !== 'America/Chicago' || options.calendar !== 'iso8601' ||
        options.numberingSystem !== 'latn' || options.hourCycle !== 'h23') fail('TIMING_BACKEND_UNAVAILABLE');
    return formatter;
  } catch { fail('TIMING_BACKEND_UNAVAILABLE'); }
}
function roundtrip(formatter, epoch, expected) {
  try {
    const fields = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
    const names = ['year', 'month', 'day', 'hour', 'minute', 'second'];
    if (names.some(name => typeof fields[name] !== 'string' || !/^[0-9]+$/.test(fields[name]))) fail('TIMING_BACKEND_UNAVAILABLE');
    return names.every((name, index) => Number(fields[name]) === expected[index]);
  } catch { fail('TIMING_BACKEND_UNAVAILABLE'); }
}
function instant(value, formatter) {
  const match = INSTANT.exec(value);
  if (!match) fail('TIMING_INSTANT_INVALID');
  const parts = match.slice(1, 7).map(Number);
  if (!calendar(...parts.slice(0, 3)) || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) fail('TIMING_CALENDAR_INVALID');
  const wall = wallEpoch(parts), matches = [];
  for (const offset of [-300, -360]) {
    const epoch = wall - offset * 60000;
    if (roundtrip(formatter, epoch, parts)) matches.push({offset, epoch});
  }
  const selected = matches.find(item => item.offset === (match[7] === '-05:00' ? -300 : -360));
  if (!selected) fail('TIMING_INSTANT_INVALID');
  // A correct explicit fold offset is a real instant. Preserve metadata and
  // separately flag ambiguity for review/automatic-timing unavailability.
  return {epoch: selected.epoch, ambiguous: matches.length === 2};
}
function result(code, reviewFlags = [], timingAvailable = false) {
  return Object.freeze({ok: code === 'TIMING_VALID', code, scope: 'selection-timing', ready: false,
    semanticValidation: 'pending', timingAvailable, operatorConfirmationRequired: true,
    verifiedRules: code === 'TIMING_VALID' ? RULES : Object.freeze([]),
    reviewFlags: Object.freeze(reviewFlags), pending: PENDING});
}
function createExchangeTimingGate() {
  let prerequisite, formatter;
  try { prerequisite = createExchangeProblemStateGate(); formatter = createFormatter(); }
  catch { fail('TIMING_BACKEND_UNAVAILABLE'); }
  return Object.freeze({validate(value) {
    try {
      let manifest;
      try { manifest = JSON.parse(canonicalExchangeJSON(value)); }
      catch { fail('TIMING_INPUT_INVALID'); }
      if (!prerequisite.validate(manifest).ok) fail('TIMING_PREREQUISITE_INVALID');
      const {eventDate, timing} = manifest.event;
      // eventDate is pattern-only in the wire schema. Preserve a supplied
      // impossible date as unavailable metadata for PC review, not a new wire rejection.
      const invalidEventDate = eventDate !== null && !validDate(eventDate);
      const values = [timing.eventStartsAt, timing.eventEndsAt,
        timing.broadcastWindow.startsAt, timing.broadcastWindow.endsAt];
      const parsed = values.map(value => value === null ? null : instant(value, formatter));
      // Event intervals are ordered; only the production/broadcast window has
      // the stated Engine24h cap. Do not invent event-duration or containment rules.
      if (parsed[0] && parsed[1] && parsed[1].epoch <= parsed[0].epoch) fail('TIMING_INTERVAL_INVALID');
      if (parsed[2] && parsed[3]) {
        const duration = parsed[3].epoch - parsed[2].epoch;
        if (duration <= 0 || duration > MAX_WINDOW_MS) fail('TIMING_INTERVAL_INVALID');
      }
      const flags = [];
      if (eventDate === null) flags.push('EVENT_DATE_UNAVAILABLE');
      else if (invalidEventDate) flags.push('EVENT_DATE_INVALID');
      if (parsed.some(value => value === null)) flags.push('INSTANTS_UNAVAILABLE');
      if (timing.unavailableReasons.length) flags.push('SOURCE_TIMING_UNAVAILABLE');
      if (parsed.some(value => value?.ambiguous)) flags.push('AMBIGUOUS_LOCAL_TIME');
      return result('TIMING_VALID', flags, flags.length === 0);
    } catch (error) {
      return result(CODES.has(error?.message) ? error.message : 'TIMING_INPUT_INVALID');
    }
  }});
}
module.exports = {createExchangeTimingGate};
