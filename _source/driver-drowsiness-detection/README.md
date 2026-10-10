# Driver Drowsiness Monitor

A local webcam demo using OpenCV and MediaPipe Face Landmarker. Frames are processed in memory and are not saved. The landmark model runs locally after a one-time download. Press **Q** or **Esc** to quit; press **Space** to stop/restart monitoring and release/reopen the camera; **A** toggles sound; **C** calibrates from a brief alert-state baseline.

## Run

Python 3.10–3.13 recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
mkdir -p models
curl -L https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task -o models/face_landmarker.task
python drowsiness.py --camera 0  # Mac camera
```

Use `--camera 1` to select another camera. If the window reports unavailable facial landmarks, face the camera in good light and try lowering `--face-confidence` (default `0.35`). Thresholds can be changed on the command line:

```bash
python drowsiness.py --ear 0.25 --mouth-opening 30 --warning-seconds 2 --alarm-seconds 30 --yawn-seconds 3 --blink-variation 0.12 --blink-alert-count 3 --blink-window-seconds 60 --calibration-ratio 0.72 --face-confidence 0.35 --alarm
```

Defaults use EAR 0.25 and inner-lip opening 30 pixels. Eye closure produces a configurable early warning (2 seconds) and alarm (30 seconds), measured with monotonic timestamps and reset by a reliable open-eye observation or missing face. Three downward EAR changes above 0.12 in a rolling 60-second window and mouth opening above 30 pixels for 3 seconds also warn. Thresholds and timing are configurable. A brief calibration estimates an alert-state baseline and applies a 0.72 ratio; calibration is optional and requires reliable open-eye samples. Mouth opening uses frame pixels and varies with camera distance.

Each session is summarized under `reports/sessions/` as JSON, including start/end, duration, monitoring periods, warnings/alarms, calibrations and detection interruptions. Alert events also append to `reports/drowsiness_events.csv`. No camera footage is saved.

## Browser demo

Serve the workspace root over localhost (required for camera access), then visit `/web/`:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/web/`. The browser version loads MediaPipe from jsDelivr and its landmark model from Google storage, requests camera access only after monitoring is enabled, analyzes frames locally, and stores reports and contacts in that browser's local storage. A user-initiated WhatsApp handoff can prepare a map link after location permission; you must review and send it yourself. It shares coordinates as a map link, not a street address, and does not provide automated emergency calls/SMS or confirmed WhatsApp delivery. The test countdown never sends messages. No provider credentials are configured. Browser local storage is not encrypted; clear reports and contacts when finished.

This is a demonstration, not a safety-certified driver aid. Camera access and face visibility affect detection. No accuracy claim is made. No video or images are written to disk. The alarm depends on system sound support; the visual alert still works if no player is available.

## Tests

```bash
python -m unittest -v
node --test web/tests/core.test.mjs
```
