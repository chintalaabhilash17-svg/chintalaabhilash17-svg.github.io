# Project status

- Implemented local OpenCV webcam monitoring with MediaPipe Face Landmarker, EAR, inner-lip opening, report timing checks, blink activity, yawning alert, optional system sound, and an animated driver-console interface.
- Defaults match the report decision module: EAR 0.25, mouth opening 30 px, closure 3 frames, three EAR changes over 60 seconds, and yawn opening for 3 seconds. Values are configurable. Face confidence defaults to 0.35 and can be adjusted with `--face-confidence`.
- Webcam frames and face landmarks are processed locally and are not saved; the model asset is bundled.
- Each new alert episode is appended to `reports/drowsiness_events.csv`; this stores event measurements only, not camera footage.
- Basic detection and event-report tests pass with `python -m unittest -v`.
- Run `python drowsiness.py` to start; review the live camera and threshold behavior in the target environment before adding it to the portfolio.
