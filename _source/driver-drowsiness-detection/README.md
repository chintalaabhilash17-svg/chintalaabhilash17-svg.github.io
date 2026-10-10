# Driver Drowsiness Detection

A local Python webcam monitor using OpenCV and MediaPipe Face Landmarker. It calculates EAR, tracks sustained eye closure and rapid EAR changes, detects sustained mouth opening, shows an animated status dashboard, and can play an optional system alarm. Each new alert episode is appended to `reports/drowsiness_events.csv`; video frames are never saved.

## Run locally

Python 3.10–3.13 recommended. From this folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
mkdir -p models
curl -L https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task -o models/face_landmarker.task
python drowsiness.py --camera 0
```

Press **Q** or **Esc** to quit; **A** toggles the optional alarm. Adjust report defaults with `--ear`, `--mouth-opening`, `--closed-frames`, `--yawn-seconds`, `--blink-variation`, `--blink-alert-count`, and `--blink-window-seconds`. The app requires a local webcam and camera permission. GitHub Pages hosts this project information and source; the Python webcam app runs locally, not in the browser.

## Tests

```bash
python -m unittest -v
```

Thresholds mirror the report decision module: EAR 0.25, mouth opening 30 px, closure for 3 frames, three EAR changes above 0.12 in a rolling 60-second window, and yawning for 3 seconds. Mouth opening is measured in frame pixels, so tune for camera distance. This is a demo, not a safety-certified driver aid; no accuracy claim is made.
