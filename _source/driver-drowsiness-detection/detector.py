"""Pure landmark and timing logic, independent of camera dependencies."""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Sequence

# MediaPipe FaceMesh landmark indices: six points per eye and inner lip centers.
LEFT_EYE = (362, 385, 387, 263, 373, 380)
RIGHT_EYE = (33, 160, 158, 133, 153, 144)
MOUTH_TOP, MOUTH_BOTTOM = 13, 14


@dataclass
class Settings:
    ear_threshold: float = 0.25
    mouth_opening_px: float = 30.0
    closed_frames: int = 3
    yawn_seconds: float = 3.0
    blink_variation: float = 0.12
    blink_alert_count: int = 3
    blink_window_seconds: float = 60.0
    camera: int = 0
    alarm: bool = False
    face_confidence: float = 0.35


def distance(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def eye_aspect_ratio(points: Sequence[Sequence[float]]) -> float:
    if len(points) != 6:
        raise ValueError("EAR requires six eye landmarks")
    eye_width = distance(points[0], points[3])
    if eye_width == 0:
        raise ValueError("Eye corner landmarks must be distinct")
    return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * eye_width)


def facial_metrics(landmarks: Sequence[Sequence[float]], width: int, height: int) -> tuple[float, float]:
    """Return mean EAR and inner-lip opening in frame pixels."""
    if len(landmarks) <= max(*LEFT_EYE, *RIGHT_EYE, MOUTH_TOP, MOUTH_BOTTOM):
        raise ValueError("Not enough facial landmarks")
    xy = [(p.x * width, p.y * height) for p in landmarks]
    ear = (eye_aspect_ratio([xy[i] for i in LEFT_EYE]) + eye_aspect_ratio([xy[i] for i in RIGHT_EYE])) / 2
    return ear, distance(xy[MOUTH_TOP], xy[MOUTH_BOTTOM])


class DrowsinessState:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.closed_frames = 0
        self.yawn_since: float | None = None
        self.previous_ear: float | None = None
        self.blinks: deque[float] = deque()
        self.alert = "Monitoring"

    def missed_face(self) -> None:
        self.closed_frames = 0
        self.yawn_since = None
        self.previous_ear = None
        self.alert = "Monitoring"

    def update(self, ear: float, mouth_px: float, now: float) -> str:
        s = self.settings
        closed = ear < s.ear_threshold
        yawning = mouth_px > s.mouth_opening_px
        self.closed_frames = self.closed_frames + 1 if closed else 0
        if self.previous_ear is not None and self.previous_ear - ear > s.blink_variation:
            self.blinks.append(now)
        self.previous_ear = ear
        if yawning:
            if self.yawn_since is None:
                self.yawn_since = now
        else:
            self.yawn_since = None
        while self.blinks and now - self.blinks[0] > s.blink_window_seconds:
            self.blinks.popleft()

        if self.closed_frames >= s.closed_frames:
            self.alert = "DROWSINESS ALERT - sustained eye closure"
        elif len(self.blinks) >= s.blink_alert_count:
            self.alert = "DROWSINESS ALERT - frequent eye changes"
        elif self.yawn_since is not None and now - self.yawn_since >= s.yawn_seconds:
            self.alert = "YAWNING ALERT"
        else:
            self.alert = "Monitoring"
        return self.alert

