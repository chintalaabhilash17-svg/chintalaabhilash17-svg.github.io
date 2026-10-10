import test from 'node:test';
import assert from 'node:assert/strict';
import { DetectionState, DEFAULTS, beginEscalation, csv, finishSession, logEvent, session, setMonitoring } from '../core.mjs';

test('timestamp closure warning, 30 second alarm, reopen reset, and missing face reset', () => {
  const d = new DetectionState({ ...DEFAULTS, warning: 2, alarm: 30 });
  assert.equal(d.update(.1, 0, 0), 'Monitoring');
  assert.match(d.update(.1, 0, 2), /WARNING/);
  assert.match(d.update(.1, 0, 30), /ALARM/);
  d.update(.3, 0, 31); assert.equal(d.closedAt, null);
  d.update(.1, 0, 32); d.missing();
  assert.equal(d.update(.1, 0, 63), 'Monitoring');
});

test('calibration adapts threshold from alert-state baseline and rejects weak samples', () => {
  const d = new DetectionState();
  assert.throws(() => d.calibrate([.3]), /10 reliable/);
  assert.equal(d.calibrate(Array(10).fill(.4)), .4 * .72);
});

test('session records enable periods/events once and exports CSV', () => {
  const r = session('2026-01-01T00:00:00.000Z');
  setMonitoring(r, true, '2026-01-01T00:00:00.000Z');
  assert.equal(logEvent(r, 'warning', {}, 'e1', '2026-01-01T00:00:02.000Z'), true);
  assert.equal(logEvent(r, 'warning', {}, 'e1'), false);
  setMonitoring(r, false, '2026-01-01T00:00:05.000Z');
  setMonitoring(r, true, '2026-01-01T00:00:10.000Z');
  finishSession(r, '2026-01-01T00:00:15.000Z');
  assert.equal(r.monitoring_periods.length, 2);
  assert.equal(r.duration_seconds, 15);
  assert.equal(r.events.length, 1);
  assert.match(csv(r), /warning/);
});

test('SOS requires consent and only logs a no-send test outcome', () => {
  const r = session();
  assert.throws(() => beginEscalation(r), /consent/);
  const flow = beginEscalation(r, { consent: true, eventId: 'alarm-1' });
  assert.equal(flow.status, 'test_mode_not_sent');
  flow.cancel();
  assert.equal(r.events[0].delivery_status, 'test_mode_not_sent');
  assert.equal(r.events[1].delivery_status, 'not_sent');
  assert.equal(beginEscalation(r, { consent: true, eventId: 'alarm-1' }).status, 'test_mode_not_sent');
  assert.equal(r.events.filter(e => e.type === 'sos_countdown_started').length, 1);
});
