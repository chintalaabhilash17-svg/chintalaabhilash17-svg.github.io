# Project status

- Desktop: timestamp-based early warning and 30-second closure alarm, configurable thresholds, brief EAR calibration, sound toggle, monitoring pause/restart, and local per-session JSON reports.
- Web: responsive local-processing dashboard, browser camera toggle, landmark overlay, calibration/sensitivity/configurable timing and mouth thresholds, local session history and JSON/CSV exports, editable/prioritized local contacts, no-send SOS countdown with cooldown, and user-confirmed WhatsApp map-link handoff.
- Privacy: no camera frames are stored. Contact/report data stays in browser storage locally. The supplied phone numbers are not embedded in source or project data.
- Tests: 10 Python tests and 4 browser-core tests pass. Python compilation and JavaScript syntax checks pass.
- Limitations: browser camera and location permission prompts require user approval; live camera inference started during local browser check and was stopped afterward. WhatsApp handoff is manual and delivery is unverified; it shares a map coordinate link, not a reverse-geocoded street address. No automated calls/SMS/WhatsApp provider is configured. No representative demographic/glasses/lighting data was available for validation; no universal accuracy/fairness claim is made.
- Next: run `python -m http.server 8000`, open `http://localhost:8000/web/`, enter test contacts locally, and test the no-send countdown. Grant camera/location access only when prompted. Before any live emergency sending, implement and configure an authorized backend provider; publish only after explicit approval.
