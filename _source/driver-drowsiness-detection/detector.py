"""Local facial metrics and timestamp-based drowsiness state."""
from __future__ import annotations

import math
import statistics
from collections import deque
from dataclasses import dataclass
from typing import Sequence

LEFT_EYE = (362, 385, 387, 263, 373, 380)
RIGHT_EYE = (33, 160, 158, 133, 153, 144)
MOUTH_TOP, MOUTH_BOTTOM = 13, 14


@dataclass
class Settings:
    ear_threshold: float = 0.25
    mouth_opening_px: float = 30.0
    closure_warning_seconds: float = 2.0
    closure_alarm_seconds: float = 30.0
    yawn_seconds: float = 3.0
    blink_variation: float = 0.12
    blink_alert_count: int = 3
    blink_window_seconds: float = 60.0
    calibration_ratio: float = 0.72
    camera: int = 0
    alarm: bool = False
    face_confidence: float = 0.35


def distance(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def eye_aspect_ratio(points: Sequence[Sequence[float]]) -> float:
    if len(points) != 6:
        raise ValueError("EAR requires six eye landmarks")
    if not all(math.isfinite(v) for point in points for v in point[:2]):
        raise ValueError("Eye landmarks must be finite")
    eye_width = distance(points[0], points[3])
    if eye_width < 1:
        raise ValueError("Eye corner landmarks must be distinct")
    ratio = (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * eye_width)
    if not 0 <= ratio <= 1:
        raise ValueError("Eye landmarks do not form a reliable eye shape")
    return ratio


def facial_metrics(landmarks: Sequence[object], width: int, height: int) -> tuple[float, float]:
    """Return mean EAR and inner-lip opening in frame pixels."""
    required = (*LEFT_EYE, *RIGHT_EYE, MOUTH_TOP, MOUTH_BOTTOM)
    if len(landmarks) <= max(required):
        raise ValueError("Not enough facial landmarks")
    xy = [(float(p.x) * width, float(p.y) * height) for p in landmarks]
    ear = (eye_aspect_ratio([xy[i] for i in LEFT_EYE]) + eye_aspect_ratio([xy[i] for i in RIGHT_EYE])) / 2
    mouth = distance(xy[MOUTH_TOP], xy[MOUTH_BOTTOM])
    if not math.isfinite(mouth):
        raise ValueError("Mouth landmarks are not reliable")
    return ear, mouth


class DrowsinessState:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.baseline_ear: float | None = None
        self.eye_closed_since: float | None = None
        self.yawn_since: float | None = None
        self.previous_ear: float | None = None
        self.blinks: deque[float] = deque()
        self.alert = "Monitoring"

    @property
    def active_ear_threshold(self) -> float:
        if self.baseline_ear is None:
            return self.settings.ear_threshold
        return self.baseline_ear * self.settings.calibration_ratio

    def calibrate(self, samples: Sequence[float]) -> float:
        valid = sorted(x for x in samples if math.isfinite(x) and 0.08 <= x <= 0.8)
        if len(valid) < 10:
            raise ValueError("Calibration needs at least 10 reliable open-eye samples")
        # Keep the upper half to reduce the effect of blinks during the open-eye baseline.
        self.baseline_ear = statistics.median(valid[len(valid) // 2:])
        self.eye_closed_since = None
        self.previous_ear = None
        self.alert = "Monitoring"
        return self.active_ear_threshold

    def missed_face(self) -> None:
        self.eye_closed_since = None
        self.yawn_since = None
        self.previous_ear = None
        self.alert = "Face or landmarks unavailable"

    def update(self, ear: float, mouth_px: float, now: float) -> str:
        if not math.isfinite(ear) or not math.isfinite(mouth_px) or ear < 0 or mouth_px < 0:
            self.missed_face()
            return self.alert
        s = self.settings
        closed = ear < self.active_ear_threshold
        if closed and self.eye_closed_since is None:
            self.eye_closed_since = now
        elif not closed:
            self.eye_closed_since = None
        if self.previous_ear is not None and self.previous_ear - ear > s.blink_variation:
            self.blinks.append(now)
        self.previous_ear = ear
        self.yawn_since = (self.yawn_since if self.yawn_since is not None else now) if mouth_px > s.mouth_opening_px else None
        while self.blinks and now - self.blinks[0] > s.blink_window_seconds:
            self.blinks.popleft()

        closed_for = 0 if self.eye_closed_since is None else now - self.eye_closed_since
        if closed_for >= s.closure_alarm_seconds:
            self.alert = "DROWSINESS ALARM - prolonged eye closure"
        elif closed_for >= s.closure_warning_seconds:
            self.alert = "WARNING - prolonged eye closure"
        elif len(self.blinks) >= s.blink_alert_count:
            self.alert = "WARNING - frequent eye changes"
        elif self.yawn_since is not None and now - self.yawn_since >= s.yawn_seconds:
            self.alert = "WARNING - sustained mouth opening"
        else:
            self.alert = "Monitoring"
        return self.alert
