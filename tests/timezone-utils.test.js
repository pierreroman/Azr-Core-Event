const test = require('node:test');
const assert = require('node:assert/strict');

const {
  easternDateTimeLocalToIso,
  isoToEasternDateTimeLocal,
} = require('../src/web/timezone-utils.js');

test('converts Eastern daylight time to the correct UTC ISO string', () => {
  assert.equal(
    easternDateTimeLocalToIso('2026-04-21T09:00'),
    '2026-04-21T13:00:00.000Z'
  );
});

test('converts Eastern standard time to the correct UTC ISO string', () => {
  assert.equal(
    easternDateTimeLocalToIso('2026-02-21T09:00'),
    '2026-02-21T14:00:00.000Z'
  );
});

test('formats stored ISO back to Eastern datetime-local value', () => {
  assert.equal(
    isoToEasternDateTimeLocal('2026-04-21T13:00:00.000Z'),
    '2026-04-21T09:00'
  );
});
