import test from 'node:test';
import assert from 'node:assert/strict';
import { DetectionState, DEFAULTS, beginEscalation, csv, drowsinessConfirmation, finishSession, finishTimedTest, logEvent, session, setMonitoring } from '../core.mjs';

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


test('five-minute test report records drowsiness result and incomplete runs honestly', () => {
  const detected = session('2026-01-01T00:00:00.000Z');
  logEvent(detected, 'warning', { status: 'WARNING - prolonged eye closure' }, 'w1', '2026-01-01T00:01:00.000Z');
  assert.equal(finishTimedTest(detected, '2026-01-01T00:00:00.000Z', { reason: 'duration_elapsed', at: '2026-01-01T00:05:00.000Z' }), true);
  assert.equal(detected.events.at(-1).result, 'possible_drowsiness_signal');
  assert.equal(detected.events.at(-1).driver_state, 'possible_drowsiness_signal');
  assert.equal(detected.events.at(-1).intoxication_assessment, 'not_assessed');
  assert.equal(detected.events.at(-1).test_duration_seconds, 300);

  const clear = session('2026-01-01T00:00:00.000Z');
  assert.equal(finishTimedTest(clear, '2026-01-01T00:00:00.000Z', { reason: 'duration_elapsed', at: '2026-01-01T00:05:00.000Z' }), false);
  assert.equal(clear.events.at(-1).result, 'no_drowsiness_detected');
  assert.equal(clear.events.at(-1).driver_state, 'appears_awake');
  assert.equal(clear.events.at(-1).intoxication_assessment, 'not_assessed');

  const interrupted = session();
  finishTimedTest(interrupted, new Date(Date.now() - 10000).toISOString(), { reason: 'user_stopped' });
  assert.equal(interrupted.events.at(-1).result, 'incomplete');
});


test('brief blink warnings do not end the test; sustained drowsiness must persist for the configured window', () => {
  assert.deepEqual(drowsinessConfirmation('WARNING - frequent eye changes', null, 1000, 5), { since: null, confirmed: false, remaining: 0 });
  assert.deepEqual(drowsinessConfirmation('WARNING - prolonged eye closure', null, 1000, 5), { since: 1000, confirmed: false, remaining: 5 });
  assert.equal(drowsinessConfirmation('WARNING - prolonged eye closure', 1000, 4999, 5).confirmed, false);
  assert.equal(drowsinessConfirmation('ALARM - prolonged eye closure', 1000, 6000, 5).confirmed, true);
  assert.equal(drowsinessConfirmation('Monitoring', 1000, 6000, 5).since, null);
});

test('confirmed drowsiness ends the test early with an explicit saved outcome', () => {
  const r = session('2026-01-01T00:00:00.000Z');
  logEvent(r, 'warning', { status: 'WARNING - prolonged eye closure' }, 'w1', '2026-01-01T00:00:02.000Z');
  finishTimedTest(r, '2026-01-01T00:00:00.000Z', { reason: 'drowsiness_confirmed', at: '2026-01-01T00:00:07.000Z' });
  assert.equal(r.events.at(-1).type, 'five_minute_test_ended_early');
  assert.equal(r.events.at(-1).result, 'drowsiness_confirmed');
  assert.equal(r.events.at(-1).driver_state, 'drowsy');
  assert.equal(r.events.at(-1).test_duration_seconds, 7);
});


test('unconfirmed drowsiness warnings are reported as a signal, not a diagnosis', () => {
  const r = session();
  logEvent(r, 'warning', { status: 'WARNING - prolonged eye closure' }, 'w1');
  finishTimedTest(r, r.started_at, { reason: 'user_stopped' });
  assert.equal(r.events.at(-1).driver_state, 'possible_drowsiness_signal');
  assert.equal(r.events.at(-1).result, 'possible_drowsiness_signal');
});

test('frequent blink warnings are not counted as confirmed drowsiness', () => {
  const r = session();
  logEvent(r, 'warning', { status: 'WARNING - frequent eye changes' }, 'blink-warning');
  finishTimedTest(r, r.started_at, { reason: 'duration_elapsed' });
  assert.equal(r.events.at(-1).result, 'no_drowsiness_detected');
});


test('camera or landmark interruptions prevent an awake assessment', () => {
  const r = session();
  logEvent(r, 'detection_interruption', { reason: 'Face unavailable' });
  finishTimedTest(r, r.started_at, { reason: 'duration_elapsed' });
  assert.equal(r.events.at(-1).driver_state, 'undetermined');
  assert.equal(r.events.at(-1).intoxication_assessment, 'not_assessed');
});
