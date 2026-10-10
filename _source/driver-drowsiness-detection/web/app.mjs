import { DEFAULTS, DetectionState, beginEscalation, csv, drowsinessConfirmation, finishSession, finishTimedTest, logEvent, session, setMonitoring } from './core.mjs';

const $ = id => document.getElementById(id), video = $('camera'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const KEYS = { sessions: 'vigil.sessions.v1', contacts: 'vigil.contacts.v1', consent: 'vigil.sos-consent.v1', sound: 'vigil.sound.v1', settings: 'vigil.settings.v1' };
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
let active = null, report = session(), detector = null, landmarker = null, stream = null, frameId = 0, calibration = [], calibrating = false, sound = load(KEYS.sound, true), escalationTimer = null, escalation = null, audioContext = null, sensitivity = 1, lastSosAt = 0, testRun = null, drowsinessSince = null;
const config = { ...DEFAULTS, ...load(KEYS.settings, {}) };
const sessions = load(KEYS.sessions, []), contacts = load(KEYS.contacts, []);
const noCamera = message => { $('statusText').textContent = message; $('statusHint').textContent = 'Check camera permission and browser support.'; $('cameraBadge').textContent = 'UNAVAILABLE'; $('stateLabel').textContent = 'CAMERA UNAVAILABLE'; $('stateDot').parentElement.classList.remove('on'); };
function toast(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }
function persist() { if (!report) return; const item = { ...report, monitoring_periods: [...report.monitoring_periods], events: [...report.events] }; const list = load(KEYS.sessions, []); const i = list.findIndex(x => x.session_id === item.session_id); i < 0 ? list.unshift(item) : list.splice(i, 1, item); save(KEYS.sessions, list.slice(0, 100)); renderHistory(); }
function beep() { if (!sound) return; try { audioContext ||= new AudioContext(); const o = audioContext.createOscillator(), g = audioContext.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(audioContext.destination); o.start(); o.stop(audioContext.currentTime + .28); } catch { toast('Sound is unavailable in this browser.'); } }
function stopAlarm() { if (alarmInterval) clearInterval(alarmInterval); alarmInterval = null; }
let alarmInterval = null;
function handleStatus(status, ear = null, mouth = null) {
  if (testRun?.startedAt) {
    const confirmation = drowsinessConfirmation(status, drowsinessSince, Date.now(), Math.max(5, Math.min(10, Number(config.confirmation) || 5)));
    drowsinessSince = confirmation.since;
    if (confirmation.confirmed) { endFiveMinuteTest('drowsiness_confirmed'); return; }
    if (drowsinessSince !== null) $('statusHint').textContent = `Confirming sustained drowsiness · ${Math.ceil(confirmation.remaining)} sec`;
  }
  $('statusText').textContent = status; $('statusHint').textContent = status.includes('unavailable') ? 'Center your face and improve lighting.' : status.includes('ALARM') ? 'Stop somewhere safe and rest.' : status.includes('WARNING') ? 'Consider a safe break.' : 'Monitoring facial signals locally.';
  $('cameraBadge').textContent = status.includes('ALARM') ? 'ALARM' : status.includes('WARNING') ? 'WARNING' : 'LIVE';
  $('earValue').textContent = ear === null ? '—' : ear.toFixed(2); $('mouthValue').textContent = mouth === null ? '—' : `${Math.round(mouth)} px`; $('blinkValue').textContent = String(detector?.blinks.length ?? 0);
  if ((status.includes('WARNING') || status.includes('ALARM')) && status !== lastStatus) {
    logEvent(report, status.includes('ALARM') ? 'alarm' : 'warning', { status, ear, mouth_opening_px: mouth }); persist();
    if (sound) { beep(); stopAlarm(); alarmInterval = setInterval(beep, 1600); }
    if (status.includes('ALARM') && $('sosConsent').checked && contacts.length && !escalation) startEscalation();
  } else if (!status.includes('WARNING') && !status.includes('ALARM')) stopAlarm();
  lastStatus = status;
}
let lastStatus = '';
function beginFiveMinuteTest() {
  if (!testRun || testRun.startedAt) return;
  testRun.startedAt = Date.now();
  logEvent(report, 'five_minute_test_started', { target_duration_seconds: 300 }); persist();
  $('fiveMinuteTest').disabled = true;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((testRun.startedAt + 300000 - Date.now()) / 1000));
    $('testCountdown').hidden = false;
    $('testCountdown').textContent = `Five-minute test · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining`;
    if (remaining === 0) endFiveMinuteTest('duration_elapsed');
  };
  tick(); testRun.timer = setInterval(tick, 1000);
}
async function endFiveMinuteTest(reason) {
  const run = testRun; if (!run) return;
  testRun = null; clearInterval(run.timer);
  finishTimedTest(report, new Date(run.startedAt ?? run.requestedAt).toISOString(), { reason }); drowsinessSince = null;
  await stop();
  finishSession(report); persist(); report = session();
  $('fiveMinuteTest').disabled = false; $('fiveMinuteTest').textContent = 'Start 5-minute test'; $('testCountdown').hidden = true;
  toast(reason === 'duration_elapsed' ? 'Five-minute test complete. Report saved in Your reports.' : reason === 'drowsiness_confirmed' ? 'Sustained drowsiness confirmed. Test ended and report saved.' : 'Test ended early. Its report was saved.');
}
function startEscalation() {
  if (escalationTimer) return;
  if (Date.now() - lastSosAt < 60000) return toast('SOS test cooldown active.');
  lastSosAt = Date.now();
  escalation = beginEscalation(report, { consent: $('sosConsent').checked, seconds: 15 }); let left = 15;
  $('statusHint').textContent = `SOS test countdown ${left}s — cancel to stop. No call or SMS will be sent.`;
  const cancel = document.createElement('button'); cancel.className = 'button secondary'; cancel.textContent = 'Cancel SOS test'; cancel.onclick = () => { clearInterval(escalationTimer); escalation.cancel(); escalationTimer = null; escalation = null; cancel.remove(); persist(); toast('SOS test cancelled; nothing was sent.'); };
  $('controls').append(cancel);
  escalationTimer = setInterval(() => { left--; $('statusHint').textContent = `SOS test countdown ${left}s — no call or SMS will be sent.`; if (left <= 0) { clearInterval(escalationTimer); escalationTimer = null; logEvent(report, 'sos_escalation_attempt', { delivery_status: 'not_sent_test_mode', contacts_count: contacts.length }); escalation = null; cancel.remove(); persist(); toast('Test finished. No call or SMS was sent.'); } }, 1000);
}
async function start() {
  if (!navigator.mediaDevices?.getUserMedia) { noCamera('Camera unsupported'); if (testRun) await endFiveMinuteTest('camera_unavailable'); return; }
  if (!window.isSecureContext) { noCamera('Secure connection required'); if (testRun) await endFiveMinuteTest('camera_unavailable'); return; }
  $('monitorToggle').disabled = true;
  try {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm');
    landmarker = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .35, minFacePresenceConfidence: .35, minTrackingConfidence: .35 });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    stream.getVideoTracks()[0].addEventListener('ended', () => { if(active){logEvent(report,'camera_error',{reason:'Camera stream interrupted'});stop().then(()=>noCamera('Camera interrupted'));} });
    video.srcObject = stream; await video.play();
    active = true; detector = new DetectionState(config); setMonitoring(report, true); beginFiveMinuteTest(); $('cameraEmpty').hidden = true; video.style.display = 'block'; $('stateLabel').textContent = 'ON · CAMERA LIVE'; $('stateDot').parentElement.classList.add('on'); $('monitorToggle').checked = true; $('calibrate').disabled = false; $('cameraBadge').textContent = 'LIVE'; $('statusText').textContent = 'Monitoring'; $('statusHint').textContent = 'Frames are analyzed on this device.'; save(KEYS.sound, sound); persist(); frameId = requestAnimationFrame(processFrame);
  } catch (e) { logEvent(report, 'camera_error', { reason: String(e?.message || e).slice(0, 160) }); await stop(); noCamera(e?.name === 'NotAllowedError' ? 'Camera permission denied' : `Could not start camera (${e?.name || 'error'})`); if (testRun) await endFiveMinuteTest('camera_unavailable'); toast(`Camera error: ${e?.name || 'unavailable'}`); }
  finally { $('monitorToggle').disabled = false; }
}
function processFrame(now) {
  if (!active || !landmarker || video.readyState < 2) { if (active) frameId = requestAnimationFrame(processFrame); return; }
  try {
    const result = landmarker.detectForVideo(video, now), points = result.faceLandmarks?.[0];
    canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!points) { const status=detector.missing(); if (lastStatus !== status) logEvent(report, 'detection_interruption', { reason: status }); handleStatus(status); }
    else {
      const earFor = ids => { const d = (a,b) => Math.hypot((points[a].x-points[b].x)*video.videoWidth,(points[a].y-points[b].y)*video.videoHeight); return (d(ids[1],ids[5])+d(ids[2],ids[4]))/(2*d(ids[0],ids[3])); };
      const ear = (earFor([362,385,387,263,373,380]) + earFor([33,160,158,133,153,144])) / 2, mouth = Math.hypot((points[13].x-points[14].x)*video.videoWidth,(points[13].y-points[14].y)*video.videoHeight);
      if (!Number.isFinite(ear) || ear > 1 || !Number.isFinite(mouth)) {const status=detector.missing();if(lastStatus!==status)logEvent(report,'detection_interruption',{reason:'Unreliable facial landmarks'});handleStatus(status);}
      else { const status = detector.update(ear, mouth, now / 1000); handleStatus(status, ear, mouth); if (calibrating && ear >= config.ear) calibration.push(ear);
        ctx.fillStyle = '#c0ed80'; ctx.strokeStyle = '#c0ed80'; ctx.lineWidth = 2;
        for (const ids of [[362,385,387,263,373,380],[33,160,158,133,153,144]]) { ctx.beginPath(); ids.forEach((id,i)=>{const x=points[id].x*canvas.width,y=points[id].y*canvas.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.stroke();ids.forEach(id=>{ctx.beginPath();ctx.arc(points[id].x*canvas.width,points[id].y*canvas.height,2.5,0,Math.PI*2);ctx.fill()}); }
        ctx.beginPath();ctx.moveTo(points[13].x*canvas.width,points[13].y*canvas.height);ctx.lineTo(points[14].x*canvas.width,points[14].y*canvas.height);ctx.stroke();
      }
    }
  } catch (e) { handleStatus(detector.missing()); logEvent(report, 'detection_interruption', { reason: String(e?.message || e).slice(0, 160) }); }
  frameId = requestAnimationFrame(processFrame);
}
async function stop() {
  active = false; cancelAnimationFrame(frameId); stopAlarm(); clearInterval(escalationTimer); escalationTimer = null; if (escalation) { escalation.cancel(); escalation = null; }
  if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; video.style.display = 'none'; ctx.clearRect(0,0,canvas.width,canvas.height); $('cameraEmpty').hidden = false; $('monitorToggle').checked = false; $('calibrate').disabled = true; $('stateLabel').textContent = 'OFF · CAMERA RELEASED'; $('stateDot').parentElement.classList.remove('on'); $('cameraBadge').textContent = 'STANDBY'; $('statusText').textContent = 'Monitoring off'; $('statusHint').textContent = 'Turn monitoring on when safely parked.';
  if (landmarker) { landmarker.close(); landmarker = null; }
  if (report) { setMonitoring(report, false); persist(); }
}
$('monitorToggle').addEventListener('change', e => { if(e.target.checked){if(sound){audioContext ||= new AudioContext();audioContext.resume().catch(()=>{});}start();}else if(testRun) endFiveMinuteTest('user_stopped'); else stop(); });
$('fiveMinuteTest').addEventListener('click', () => { if (testRun) return; if (report.events.length || report._enabledAt) { setMonitoring(report, false); finishSession(report); persist(); } report = session(); if (active) setMonitoring(report, true); testRun = { requestedAt: Date.now(), startedAt: null, timer: null }; $('fiveMinuteTest').textContent = 'Test running…'; persist(); if (active) beginFiveMinuteTest(); else { $('monitorToggle').checked = true; $('monitorToggle').dispatchEvent(new Event('change')); } });
$('soundToggle').checked = sound; $('soundToggle').addEventListener('change', e => { sound = e.target.checked; save(KEYS.sound, sound); if(sound){audioContext ||= new AudioContext();audioContext.resume().catch(()=>{});} logEvent(report, sound ? 'sound_enabled' : 'sound_disabled'); if (!sound) stopAlarm(); persist(); });
$('calibrate').addEventListener('click', async () => { calibration = []; calibrating = true; $('calibrate').textContent = 'Look alert at camera…'; await new Promise(r => setTimeout(r, 3000)); calibrating = false; $('calibrate').textContent = 'Calibrate for me'; try { const value = detector.calibrate(calibration); config.ear = value; sensitivity = -1; $('sensitivityValue').textContent='Calibrated'; save(KEYS.settings,config); logEvent(report, 'calibration_completed', { threshold: value }); persist(); toast(`Calibration complete · EAR ${value.toFixed(2)}`); } catch (e) { toast(e.message); } });
$('sensitivity').addEventListener('input', e => { sensitivity = Number(e.target.value); config.ear = [.29,.25,.21][sensitivity]; $('sensitivityValue').textContent = ['More sensitive','Standard','Less sensitive'][sensitivity]; if (detector) detector.baseline = null; save(KEYS.settings,config); });
for (const [id,key] of [['mouthThreshold','mouth'],['warningThreshold','warning'],['alarmThreshold','alarm']]) { $(id).value=config[key]; $(id).addEventListener('change',e=>{const value=Number(e.target.value),other=key==='warning'?config.alarm:key==='alarm'?config.warning:Infinity;if(!Number.isFinite(value)||value<=0||value>=other){e.target.value=config[key];return toast('Enter a positive threshold; warning must be shorter than alarm.');}config[key]=value;save(KEYS.settings,config);if(detector)detector.config=config;}); }
$('confirmationThreshold').value=config.confirmation; $('confirmationThreshold').addEventListener('change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<5||value>10){e.target.value=config.confirmation;return toast('Confirmation must be between 5 and 10 seconds.');}config.confirmation=value;save(KEYS.settings,config);});
if (![.29,.25,.21].some(value=>Math.abs(config.ear-value)<.001)) $('sensitivityValue').textContent='Calibrated';
$('sosConsent').checked = load(KEYS.consent, false); $('sosConsent').addEventListener('change', e => { save(KEYS.consent, e.target.checked); if(!e.target.checked&&escalationTimer){clearInterval(escalationTimer);escalationTimer=null;escalation?.cancel();escalation=null;} toast(e.target.checked ? 'Local SOS test mode enabled.' : 'SOS test mode disabled.'); renderContacts(); });
$('contactForm').addEventListener('submit', e => { e.preventDefault(); const name = $('contactName').value.trim(), phone = $('contactPhone').value.trim(); if (!/^\+?[0-9 ()-]{8,20}$/.test(phone)) return toast('Enter a valid phone number.'); contacts.push({ id: crypto.randomUUID(), name, phone, priority: contacts.length + 1 }); save(KEYS.contacts, contacts); $('contactName').value = ''; $('contactPhone').value = ''; renderContacts(); toast('Saved on this device only.'); });
function renderContacts() { $('contacts').replaceChildren(...contacts.map((c,i) => { const el=document.createElement('span'); el.className='contact-pill'; el.textContent=`${i+1}. ${c.name} · ••••${c.phone.replace(/\D/g,'').slice(-4)}`; const edit=document.createElement('button'); edit.textContent='Edit'; edit.onclick=()=>{const name=prompt('Contact name',c.name),phone=prompt('Phone number',c.phone);if(name?.trim()&&phone?.trim()&&/^\+?[0-9 ()-]{8,20}$/.test(phone)){contacts[i]={...c,name:name.trim(),phone:phone.trim()};save(KEYS.contacts,contacts);renderContacts();}};el.append(edit); if(i>0){const up=document.createElement('button');up.textContent='Prioritize';up.onclick=()=>{[contacts[i-1],contacts[i]]=[contacts[i],contacts[i-1]];save(KEYS.contacts,contacts);renderContacts();};el.append(up);} const del=document.createElement('button'); del.textContent='Remove'; del.onclick=()=>{contacts.splice(i,1);save(KEYS.contacts,contacts);renderContacts();};el.append(del);return el;})); $('testSos').disabled = !contacts.length || !$('sosConsent').checked; $('shareLocation').disabled = !contacts.length; }
$('testSos').addEventListener('click', () => { if (!contacts.length || !$('sosConsent').checked) return; startEscalation(); });
$('shareLocation').addEventListener('click', () => {
  const status = $('locationStatus');
  if (!window.isSecureContext) { status.textContent = 'Location needs a secure page (HTTPS or localhost). Open the deployed HTTPS site or use localhost.'; return; }
  if (!contacts.length || !navigator.geolocation) { status.textContent = 'This browser does not provide location access.'; return; }
  const contact = contacts[0], phone = contact.phone.startsWith('+') ? contact.phone.replace(/\D/g,'') : `91${contact.phone.replace(/\D/g,'')}`;
  const popup = window.open('about:blank', '_blank');
  status.textContent = 'Requesting your location from the browser… Allow location access in the browser prompt.';
  const found = position => {
    const { latitude, longitude, accuracy } = position.coords;
    const message = `Vigil location share requested at ${new Date(position.timestamp).toLocaleString()}. Approximate accuracy: ${Math.round(accuracy)} m. Map: https://maps.google.com/?q=${latitude},${longitude}`;
    status.textContent = `Location found · accuracy about ${Math.round(accuracy)} m. WhatsApp will open a draft for you to review; nothing is sent automatically.`;
    logEvent(report, 'location_detected', { accuracy_meters: Math.round(accuracy), delivery_status: 'user_action_required' });
    logEvent(report, 'whatsapp_handoff_prepared', { delivery_status: 'user_action_required', contact_priority: 1 }); persist();
    if (popup) popup.location = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    else status.textContent += ' Allow pop-ups and try again to open WhatsApp.';
  };
  const failed = (error, precise) => {
    if (error.code !== 1 && precise) { status.textContent = 'Precise GPS did not respond; trying the device network location…'; requestLocation(false); return; }
    popup?.close();
    const message = error.code === 1 ? 'Location permission denied. Allow location for this site in browser settings, then try again.' : error.code === 2 ? 'Device location is unavailable. Turn on Location Services and check network or GPS reception.' : 'Location request timed out. Check Location Services and network, then try again.';
    status.textContent = message;
    logEvent(report, 'location_error', { reason: error.code === 1 ? 'permission_denied' : error.code === 2 ? 'position_unavailable' : 'timeout' }); persist();
  };
  function requestLocation(precise) {
    navigator.geolocation.getCurrentPosition(found, error => failed(error, precise), { enableHighAccuracy: precise, timeout: precise ? 12000 : 25000, maximumAge: 0 });
  }
  requestLocation(true);
});
function renderHistory() { const list=load(KEYS.sessions,[]), root=$('historyList'); root.replaceChildren(); if(!list.length){root.innerHTML='<p class="empty">Reports from this browser appear here after a session.</p>';return;} for(const r of list){const item=document.createElement('article');item.className='report-entry';const row=document.createElement('div');row.className='history-item';const identity=document.createElement('div');const date=document.createElement('b');date.textContent=new Date(r.started_at).toLocaleString();const meta=document.createElement('span');meta.textContent=`${r.duration_seconds == null ? 'In progress' : `${Math.round(r.duration_seconds)} sec`} · ${r.events?.length||0} events`;identity.append(date,meta);const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='View report';details.append(summary);const body=document.createElement('div');body.className='history-report';const totals=document.createElement('p');totals.textContent=`Started: ${new Date(r.started_at).toLocaleString()} · Ended: ${r.ended_at ? new Date(r.ended_at).toLocaleString() : 'Session still open'} · Duration: ${r.duration_seconds == null ? 'in progress' : `${Math.round(r.duration_seconds)} seconds`}`;body.append(totals);for(const event of r.events||[]){const line=document.createElement('p');const result=event.delivery_status==='test_mode_not_sent'?' · TEST MODE — NOT SENT':event.delivery_status==='not_sent'?' · NOT SENT':'';line.textContent=`${event.type.replaceAll('_',' ')} · ${new Date(event.timestamp).toLocaleString()}${result}${event.status?` · ${event.status}`:''}${event.result?` · ${event.result.replaceAll('_',' ')}`:''}${event.driver_state?` · ${({drowsy:event.end_reason==='drowsiness_confirmed'||(r.events||[]).some(e=>e.type==='alarm')?'Driver is drowsy':'Possible drowsiness signal; test did not confirm',appears_awake:'Driver appears awake',undetermined:'Driver state undetermined',possible_drowsiness_signal:'Possible drowsiness signal; test did not confirm'})[event.driver_state]||event.driver_state}`:''}${event.intoxication_assessment?` · Alcohol intoxication: ${event.intoxication_assessment.replaceAll('_',' ')}`:''}${event.reason?` · ${event.reason}`:''}${event.end_reason?` · ${event.end_reason.replaceAll('_',' ')}`:''}`;body.append(line);}if(!(r.events||[]).length){const empty=document.createElement('p');empty.textContent='No events recorded.';body.append(empty);}details.append(body);row.append(identity,details);item.append(row);root.append(item);} }
function download(name, data, type) { const a=document.createElement('a'), blob=new Blob([data],{type});a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href); }
$('exportJson').onclick=()=>download('vigil-session-history.json',JSON.stringify(load(KEYS.sessions,[]),null,2),'application/json');
$('exportCsv').onclick=()=>download('vigil-session-history.csv',['session_id,started_at,ended_at,duration_seconds,event_type,event_timestamp,delivery_status',...load(KEYS.sessions,[]).flatMap(r=>r.events?.length?r.events.map(e=>[r.session_id,r.started_at,r.ended_at,r.duration_seconds,e.type,e.timestamp,e.delivery_status||''].map(x=>`"${String(x??'').replaceAll('"','""')}"`).join(',')):[[r.session_id,r.started_at,r.ended_at,r.duration_seconds,'','',''].join(',')])].join('\n'),'text/csv');
$('deleteReports').onclick=()=>{if(confirm('Delete all locally stored session reports?')){localStorage.removeItem(KEYS.sessions);renderHistory();toast('Reports deleted.');}};
window.addEventListener('pagehide',()=>{if(testRun){clearInterval(testRun.timer);finishTimedTest(report,new Date(testRun.startedAt??testRun.requestedAt).toISOString(),{reason:'page_closed'});}if(active)logEvent(report,'session_interruption',{reason:'Page closed'});setMonitoring(report,false);finishSession(report);persist();});
renderContacts();renderHistory();
