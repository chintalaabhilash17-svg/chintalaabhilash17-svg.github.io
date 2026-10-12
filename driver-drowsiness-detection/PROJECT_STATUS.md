# Project status

- Desktop: local OpenCV/MediaPipe monitor with timestamp-based eye-closure warning/alarm, configurable thresholds, optional sound, calibration, and per-session reports.
- Web: GitHub Pages browser demo at https://chintalaabhilash17-svg.github.io/driver-drowsiness/ with local camera processing, configurable alerts, local test reports/exports, and no-send SOS demo.
- Privacy: webcam frames are not saved; reports and contacts stay in browser storage. No contact numbers, credentials, or user reports are included in this repository.
- Camera overlay: preview and landmark canvas now use the camera's aspect ratio; a face outline provides context around the eye markers.
- Tests: 11 Python unit tests and 10 browser-core tests pass; JavaScript syntax checks pass. The physical-camera overlay still needs a device check.
- Limitations: no completed five-minute live-camera test is available; the narrated video is a camera-off walkthrough, not live-camera evidence. No automated emergency call/SMS provider is configured, WhatsApp is manual and unverified, and location lookup has not been confirmed. No universal accuracy or fairness claim is made. This is not yet packaged as an App Store or Play Store app; native packaging, device testing, and store review are pending.
