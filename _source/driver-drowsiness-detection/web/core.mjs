export const DEFAULTS = Object.freeze({ ear: .25, mouth: 30, warning: 2, alarm: 30, yawn: 3, calibrationRatio: .72 });

export class DetectionState {
  constructor(config = DEFAULTS) { this.config = config; this.baseline = null; this.closedAt = null; this.yawnAt = null; this.prev = null; this.blinks = []; this.status = 'Ready'; }
  get threshold() { return this.baseline ? this.baseline * this.config.calibrationRatio : this.config.ear; }
  calibrate(samples) {
    const values = samples.filter(x => Number.isFinite(x) && x >= .08 && x <= .8).sort((a,b) => a-b);
    if (values.length < 10) throw new Error('Calibration needs 10 reliable alert-state samples.');
    const upper = values.slice(Math.floor(values.length / 2));
    this.baseline = upper[Math.floor(upper.length / 2)];
    this.closedAt = null; this.prev = null; this.status = 'Monitoring'; return this.threshold;
  }
  missing() { this.closedAt = null; this.yawnAt = null; this.prev = null; this.status = 'Face or landmarks unavailable'; return this.status; }
  update(ear, mouth, now) {
    if (!Number.isFinite(ear) || !Number.isFinite(mouth) || ear < 0 || mouth < 0) return this.missing();
    if (ear < this.threshold) this.closedAt ??= now; else this.closedAt = null;
    if (this.prev !== null && this.prev - ear > .12) this.blinks.push(now);
    this.prev = ear; this.blinks = this.blinks.filter(t => now - t <= 60);
    if (mouth > this.config.mouth) this.yawnAt ??= now; else this.yawnAt = null;
    const duration = this.closedAt === null ? 0 : now - this.closedAt;
    this.status = duration >= this.config.alarm ? 'ALARM - prolonged eye closure' : duration >= this.config.warning ? 'WARNING - prolonged eye closure' : this.blinks.length >= 3 ? 'WARNING - frequent eye changes' : this.yawnAt !== null && now - this.yawnAt >= this.config.yawn ? 'WARNING - sustained mouth opening' : 'Monitoring';
    return this.status;
  }
}

export function session(startedAt = new Date().toISOString()) {
  return { session_id: crypto.randomUUID(), started_at: startedAt, ended_at: null, duration_seconds: null, monitoring_periods: [], events: [], _enabledAt: null, _eventIds: new Set() };
}
export function logEvent(report, type, details = {}, id = crypto.randomUUID(), at = new Date().toISOString()) {
  if (report._eventIds.has(id)) return false;
  report._eventIds.add(id); report.events.push({ event_id: id, type, timestamp: at, ...details }); return true;
}
export function finishSession(report, at = new Date().toISOString()) {
  if (report._enabledAt) report.monitoring_periods.push({ started_at: report._enabledAt, ended_at: at, duration_seconds: Math.max(0, (Date.parse(at) - Date.parse(report._enabledAt)) / 1000) });
  report.ended_at = at; report.duration_seconds = Math.max(0, (Date.parse(at) - Date.parse(report.started_at)) / 1000); delete report._enabledAt; delete report._eventIds; return report;
}
export function setMonitoring(report, enabled, at = new Date().toISOString()) {
  if (enabled && !report._enabledAt) report._enabledAt = at;
  if (!enabled && report._enabledAt) { report.monitoring_periods.push({ started_at: report._enabledAt, ended_at: at, duration_seconds: Math.max(0, (Date.parse(at)-Date.parse(report._enabledAt))/1000) }); report._enabledAt = null; }
}
export function csv(report) {
  const rows = [['record_type','timestamp','type','details'], ['session', report.started_at, 'start', report.ended_at || '']];
  for (const period of report.monitoring_periods) rows.push(['monitoring', period.started_at, 'period', period.ended_at]);
  for (const event of report.events) rows.push(['event',event.timestamp,event.type,JSON.stringify(event)]);
  return rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\n');
}

const escalationEvents = new Map();
export function beginEscalation(report, options = {}) {
  if (!options.consent) throw new Error('Explicit consent is required before SOS escalation.');
  const id = options.eventId || crypto.randomUUID();
  if (escalationEvents.has(id)) return escalationEvents.get(id);
  logEvent(report, 'sos_countdown_started', { delivery_status: 'test_mode_not_sent', seconds: options.seconds ?? 15 }, id);
  const flow = { id, status: 'test_mode_not_sent', cancel() { logEvent(report, 'sos_escalation_cancelled', { delivery_status: 'not_sent' }, `${id}:cancelled`); } };
  escalationEvents.set(id, flow);
  return flow;
}
