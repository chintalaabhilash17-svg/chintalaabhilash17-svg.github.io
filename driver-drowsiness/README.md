# Driver Drowsiness Web Demo

Open the deployed browser demo from the portfolio. Use a secure context, enable monitoring to request camera permission, and use local session exports and configurable thresholds. Frames stay in the browser; model and MediaPipe runtime load from their public CDNs.

The SOS countdown is a no-send test. The optional WhatsApp location handoff requires an explicit user action and location permission, prepares a map coordinate link, and leaves sending to the user. Automated calls/SMS and delivery confirmation are not configured. This is not a safety-certified driving aid.

To run tests locally, use `node --test tests/core.test.mjs`.
