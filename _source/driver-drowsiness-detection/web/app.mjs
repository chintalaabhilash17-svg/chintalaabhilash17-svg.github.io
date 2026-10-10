import { DEFAULTS, DetectionState, beginEscalation, csv, finishSession, logEvent, session, setMonitoring } from './core.mjs';

const $ = id => document.getElementById(id), video = $('camera'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const KEYS = { sessions: 'vigil.sessions.v1', contacts: 'vigil.contacts.v1', consent: 'vigil.sos-consent.v1', sound: 'vigil.sound.v1', settings: 'vigil.settings.v1' };
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
let active = null, report = session(), detector = null, landmarker = null, stream = null, frameId = 0, calibration = [], calibrating = false, sound = load(KEYS.sound, true), escalationTimer = null, escalation = null, audioContext = null, sensitivity = 1, lastSosAt = 0;
const config = { ...DEFAULTS, ...load(KEYS.settings, {}) };
const sessions = load(KEYS.sessions, []), contacts = load(KEYS.contacts, []);
const noCamera = message => { $('statusText').textContent = message; $('statusHint').textContent = 'Check camera permission and browser support.'; $('cameraBadge').textContent = 'UNAVAILABLE'; $('stateLabel').textContent = 'CAMERA UNAVAILABLE'; $('stateDot').parentElement.classList.remove('on'); };
function toast(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }
function persist() { if (!report) return; const item = { ...report, monitoring_periods: [...report.monitoring_periods], events: [...report.events] }; const list = load(KEYS.sessions, []); const i = list.findIndex(x => x.session_id === item.session_id); i < 0 ? list.unshift(item) : list.splice(i, 1, item); save(KEYS.sessions, list.slice(0, 100)); renderHistory(); }
function beep() { if (!sound) return; try { audioContext ||= new AudioContext(); const o = audioContext.createOscillator(), g = audioContext.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(audioContext.destination); o.start(); o.stop(audioContext.currentTime + .28); } catch { toast('Sound is unavailable in this browser.'); } }
function stopAlarm() { if (alarmInterval) clearInterval(alarmInterval); alarmInterval = null; }
let alarmInterval = null;
function handleStatus(status, ear = null, mouth = null) {
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
  if (!navigator.mediaDevices?.getUserMedia) return noCamera('Camera unsupported');
  if (!window.isSecureContext) return noCamera('Secure connection required');
  $('monitorToggle').disabled = true;
  try {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm');
    landmarker = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .35, minFacePresenceConfidence: .35, minTrackingConfidence: .35 });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    stream.getVideoTracks()[0].addEventListener('ended', () => { if(active){logEvent(report,'camera_error',{reason:'Camera stream interrupted'});stop().then(()=>noCamera('Camera interrupted'));} });
    video.srcObject = stream; await video.play();
    active = true; detector = new DetectionState(config); setMonitoring(report, true); $('cameraEmpty').hidden = true; video.style.display = 'block'; $('stateLabel').textContent = 'ON · CAMERA LIVE'; $('stateDot').parentElement.classList.add('on'); $('monitorToggle').checked = true; $('calibrate').disabled = false; $('cameraBadge').textContent = 'LIVE'; $('statusText').textContent = 'Monitoring'; $('statusHint').textContent = 'Frames are analyzed on this device.'; save(KEYS.sound, sound); persist(); frameId = requestAnimationFrame(processFrame);
  } catch (e) { logEvent(report, 'camera_error', { reason: String(e?.message || e).slice(0, 160) }); await stop(); noCamera(e?.name === 'NotAllowedError' ? 'Camera permission denied' : `Could not start camera (${e?.name || 'error'})`); toast(`Camera error: ${e?.name || 'unavailable'}`); }
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
$('monitorToggle').addEventListener('change', e => { if(e.target.checked){if(sound){audioContext ||= new AudioContext();audioContext.resume().catch(()=>{});}start();}else stop(); });
$('soundToggle').checked = sound; $('soundToggle').addEventListener('change', e => { sound = e.target.checked; save(KEYS.sound, sound); if(sound){audioContext ||= new AudioContext();audioContext.resume().catch(()=>{});} logEvent(report, sound ? 'sound_enabled' : 'sound_disabled'); if (!sound) stopAlarm(); persist(); });
$('calibrate').addEventListener('click', async () => { calibration = []; calibrating = true; $('calibrate').textContent = 'Look alert at camera…'; await new Promise(r => setTimeout(r, 3000)); calibrating = false; $('calibrate').textContent = 'Calibrate for me'; try { const value = detector.calibrate(calibration); config.ear = value; sensitivity = -1; $('sensitivityValue').textContent='Calibrated'; save(KEYS.settings,config); logEvent(report, 'calibration_completed', { threshold: value }); persist(); toast(`Calibration complete · EAR ${value.toFixed(2)}`); } catch (e) { toast(e.message); } });
$('sensitivity').addEventListener('input', e => { sensitivity = Number(e.target.value); config.ear = [.29,.25,.21][sensitivity]; $('sensitivityValue').textContent = ['More sensitive','Standard','Less sensitive'][sensitivity]; if (detector) detector.baseline = null; save(KEYS.settings,config); });
for (const [id,key] of [['mouthThreshold','mouth'],['warningThreshold','warning'],['alarmThreshold','alarm']]) { $(id).value=config[key]; $(id).addEventListener('change',e=>{const value=Number(e.target.value),other=key==='warning'?config.alarm:key==='alarm'?config.warning:Infinity;if(!Number.isFinite(value)||value<=0||value>=other){e.target.value=config[key];return toast('Enter a positive threshold; warning must be shorter than alarm.');}config[key]=value;save(KEYS.settings,config);if(detector)detector.config=config;}); }
if (![.29,.25,.21].some(value=>Math.abs(config.ear-value)<.001)) $('sensitivityValue').textContent='Calibrated';
$('sosConsent').checked = load(KEYS.consent, false); $('sosConsent').addEventListener('change', e => { save(KEYS.consent, e.target.checked); if(!e.target.checked&&escalationTimer){clearInterval(escalationTimer);escalationTimer=null;escalation?.cancel();escalation=null;} toast(e.target.checked ? 'Local SOS test mode enabled.' : 'SOS test mode disabled.'); renderContacts(); });
$('contactForm').addEventListener('submit', e => { e.preventDefault(); const name = $('contactName').value.trim(), phone = $('contactPhone').value.trim(); if (!/^\+?[0-9 ()-]{8,20}$/.test(phone)) return toast('Enter a valid phone number.'); contacts.push({ id: crypto.randomUUID(), name, phone, priority: contacts.length + 1 }); save(KEYS.contacts, contacts); $('contactName').value = ''; $('contactPhone').value = ''; renderContacts(); toast('Saved on this device only.'); });
function renderContacts() { $('contacts').replaceChildren(...contacts.map((c,i) => { const el=document.createElement('span'); el.className='contact-pill'; el.textContent=`${i+1}. ${c.name} · ••••${c.phone.replace(/\D/g,'').slice(-4)}`; const edit=document.createElement('button'); edit.textContent='Edit'; edit.onclick=()=>{const name=prompt('Contact name',c.name),phone=prompt('Phone number',c.phone);if(name?.trim()&&phone?.trim()&&/^\+?[0-9 ()-]{8,20}$/.test(phone)){contacts[i]={...c,name:name.trim(),phone:phone.trim()};save(KEYS.contacts,contacts);renderContacts();}};el.append(edit); if(i>0){const up=document.createElement('button');up.textContent='Prioritize';up.onclick=()=>{[contacts[i-1],contacts[i]]=[contacts[i],contacts[i-1]];save(KEYS.contacts,contacts);renderContacts();};el.append(up);} const del=document.createElement('button'); del.textContent='Remove'; del.onclick=()=>{contacts.splice(i,1);save(KEYS.contacts,contacts);renderContacts();};el.append(del);return el;})); $('testSos').disabled = !contacts.length || !$('sosConsent').checked; $('shareLocation').disabled = !contacts.length; }
$('testSos').addEventListener('click', () => { if (!contacts.length || !$('sosConsent').checked) return; startEscalation(); });
$('shareLocation').addEventListener('click', () => {
  if (!contacts.length || !navigator.geolocation) return toast('Location is unavailable in this browser.');
  const contact = contacts[0], phone = contact.phone.startsWith('+') ? contact.phone.replace(/\D/g,'') : `91${contact.phone.replace(/\D/g,'')}`;
  const popup = window.open('about:blank', '_blank');
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    const message = `Vigil location share requested at ${new Date(position.timestamp).toLocaleString()}. Approximate accuracy: ${Math.round(accuracy)} m. Map: https://maps.google.com/?q=${latitude},${longitude}`;
    logEvent(report, 'whatsapp_handoff_prepared', { delivery_status: 'user_action_required', contact_priority: 1 }); persist();
    if (popup) popup.location = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    else toast('Allow pop-ups, then try again. Location was not shared.');
  }, error => { popup?.close(); logEvent(report, 'location_error', { reason: error.code === 1 ? 'permission_denied' : 'unavailable' }); persist(); toast('Location permission denied or unavailable; nothing was shared.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
});
function renderHistory() { const list=load(KEYS.sessions,[]), root=$('historyList'); root.replaceChildren(); if(!list.length){root.innerHTML='<p class="empty">Reports from this browser appear here after a session.</p>';return;} for(const r of list){const el=document.createElement('div');el.className='history-item';const date=document.createElement('b');date.textContent=new Date(r.started_at).toLocaleString();const meta=document.createElement('span');meta.textContent=`${r.duration_seconds ? Math.round(r.duration_seconds)+' sec' : 'In progress'} · ${r.events?.length||0} events`;const detail=document.createElement('button');detail.textContent='Details';detail.onclick=()=>alert(JSON.stringify(r,null,2));el.append(date,meta,detail);root.append(el);} }
function download(name, data, type) { const a=document.createElement('a'), blob=new Blob([data],{type});a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href); }
$('exportJson').onclick=()=>download('vigil-session-history.json',JSON.stringify(load(KEYS.sessions,[]),null,2),'application/json');
$('exportCsv').onclick=()=>download('vigil-session-history.csv',['session_id,started_at,ended_at,duration_seconds,event_type,event_timestamp,delivery_status',...load(KEYS.sessions,[]).flatMap(r=>r.events?.length?r.events.map(e=>[r.session_id,r.started_at,r.ended_at,r.duration_seconds,e.type,e.timestamp,e.delivery_status||''].map(x=>`"${String(x??'').replaceAll('"','""')}"`).join(',')):[[r.session_id,r.started_at,r.ended_at,r.duration_seconds,'','',''].join(',')])].join('\n'),'text/csv');
$('deleteReports').onclick=()=>{if(confirm('Delete all locally stored session reports?')){localStorage.removeItem(KEYS.sessions);renderHistory();toast('Reports deleted.');}};
window.addEventListener('pagehide',()=>{if(active)logEvent(report,'session_interruption',{reason:'Page closed'});setMonitoring(report,false);finishSession(report);persist();});
renderContacts();renderHistory();
