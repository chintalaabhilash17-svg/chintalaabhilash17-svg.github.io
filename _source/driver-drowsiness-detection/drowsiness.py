"""Local webcam driver-drowsiness monitor using MediaPipe Face Landmarker."""
from __future__ import annotations

import argparse
import math
from collections import deque
from pathlib import Path
import subprocess
import sys
import time
try:
    import cv2
    import mediapipe as mp
    import numpy as np
except ImportError as exc:
    raise SystemExit("Missing camera dependencies. Install them with: python -m pip install -r requirements.txt") from exc

from detector import DrowsinessState, LEFT_EYE, MOUTH_BOTTOM, MOUTH_TOP, RIGHT_EYE, Settings, facial_metrics
from reporting import write_alert_record
from session_reporting import SessionJournal

def play_alarm():
    """Play one short system sound where a standard player is available."""
    try:
        if sys.platform == "win32":
            import winsound
            winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
        elif sys.platform == "darwin":
            return subprocess.Popen(["afplay", "/System/Library/Sounds/Sosumi.aiff"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            for player in ("paplay", "beep"):
                try:
                    return subprocess.Popen([player, "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"] if player == "paplay" else [player], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except FileNotFoundError:
                    continue
    except (OSError, RuntimeError):
        return None


def stop_alarm(process) -> None:
    if process is not None and process.poll() is None:
        process.terminate()


def parse_args() -> Settings:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ear", type=float, default=.25, help="Eye-closure EAR threshold (default: 0.25)")
    p.add_argument("--mouth-opening", type=float, default=30, help="Inner-lip opening threshold in frame pixels (default: 30)")
    p.add_argument("--warning-seconds", type=float, default=2, help="Continuous eye-closure warning delay")
    p.add_argument("--alarm-seconds", type=float, default=30, help="Continuous eye-closure alarm delay")
    p.add_argument("--yawn-seconds", type=float, default=3, help="Yawn duration before alert (report: 3 seconds)")
    p.add_argument("--blink-variation", type=float, default=.12, help="EAR change counted toward blink activity (report: 0.12)")
    p.add_argument("--blink-alert-count", type=int, default=3, help="EAR changes in the rolling window before alert (report: 3)")
    p.add_argument("--blink-window-seconds", type=float, default=60, help="Rolling blink activity window in seconds (report: 60)")
    p.add_argument("--calibration-ratio", type=float, default=.72, help="Calibrated closed-eye EAR as a fraction of open-eye baseline")
    p.add_argument("--face-confidence", type=float, default=.35, help="Face detection/presence/tracking confidence from 0 to 1 (lower helps in dim or difficult scenes)")
    p.add_argument("--camera", type=int, default=0, help="OpenCV camera index (default: Mac camera 0)")
    p.add_argument("--alarm", action="store_true", help="Enable a short system sound when an alert begins")
    a = p.parse_args()
    values = (a.ear, a.mouth_opening, a.warning_seconds, a.alarm_seconds, a.yawn_seconds, a.blink_variation, a.blink_window_seconds, a.calibration_ratio)
    if any(v <= 0 or not math.isfinite(v) for v in values) or a.warning_seconds >= a.alarm_seconds or not 0 < a.face_confidence <= 1 or not 0 < a.calibration_ratio < 1 or a.blink_alert_count < 1 or a.camera < 0:
        p.error("thresholds and timing values must be finite and greater than zero")
    return Settings(ear_threshold=a.ear, mouth_opening_px=a.mouth_opening, closure_warning_seconds=a.warning_seconds, closure_alarm_seconds=a.alarm_seconds, yawn_seconds=a.yawn_seconds, blink_variation=a.blink_variation, blink_alert_count=a.blink_alert_count, blink_window_seconds=a.blink_window_seconds, calibration_ratio=a.calibration_ratio, camera=a.camera, alarm=a.alarm, face_confidence=a.face_confidence)


def render_dashboard(frame, status, ear, mouth, blinks, now, ear_history):
    height, camera_width = frame.shape[:2]
    panel_width = 310
    view = cv2.copyMakeBorder(frame, 0, 0, 0, panel_width, cv2.BORDER_CONSTANT, value=(24, 27, 32))
    x = camera_width
    pulse = (math.sin(now * (4 + min(len(blinks), 5) * .7)) + 1) / 2
    alert = "WARNING" in status or "ALARM" in status
    color = (65, 75, 245) if alert else (75, 210, 135) if status == "Monitoring" else (20, 190, 245)

    cv2.putText(view, "VIGIL", (x + 20, 34), cv2.FONT_HERSHEY_DUPLEX, .75, (242, 244, 247), 2, cv2.LINE_AA)
    cv2.circle(view, (x + panel_width - 68, 27), 5 + int(pulse * 3), color, -1, cv2.LINE_AA)
    cv2.putText(view, "LIVE", (x + panel_width - 54, 32), cv2.FONT_HERSHEY_SIMPLEX, .42, (190, 198, 208), 1, cv2.LINE_AA)

    cv2.rectangle(view, (x + 16, 56), (x + panel_width - 16, 130), (39, 44, 52), -1, cv2.LINE_AA)
    cv2.putText(view, "DRIVER STATUS", (x + 28, 80), cv2.FONT_HERSHEY_SIMPLEX, .4, (155, 165, 178), 1, cv2.LINE_AA)
    title = ("EYE CLOSURE ALERT" if "closure" in status else "BLINK ACTIVITY ALERT" if "eye changes" in status else "YAWNING ALERT") if alert else status.upper()
    cv2.putText(view, title, (x + 28, 108), cv2.FONT_HERSHEY_SIMPLEX, .54, color, 2 if alert else 1, cv2.LINE_AA)
    if "unavailable" in status.lower() or status == "No face detected":
        cv2.putText(view, "Center face; improve lighting", (x + 28, 123), cv2.FONT_HERSHEY_SIMPLEX, .31, (190, 198, 208), 1, cv2.LINE_AA)
    if alert:
        cv2.rectangle(view, (x + 16, 56), (x + panel_width - 16, 130), color, 1 + int(pulse * 2), cv2.LINE_AA)

    cv2.putText(view, "EYE ASPECT RATIO", (x + 22, 164), cv2.FONT_HERSHEY_SIMPLEX, .4, (161, 170, 182), 1, cv2.LINE_AA)
    cv2.putText(view, "--" if "unavailable" in status.lower() or status == "No face detected" else f"{ear:.2f}", (x + 22, 198), cv2.FONT_HERSHEY_DUPLEX, .9, (245, 246, 248), 1, cv2.LINE_AA)
    cv2.putText(view, "MOUTH OPENING", (x + 165, 164), cv2.FONT_HERSHEY_SIMPLEX, .4, (161, 170, 182), 1, cv2.LINE_AA)
    cv2.putText(view, "--" if "unavailable" in status.lower() or status == "No face detected" else f"{mouth:.0f} px", (x + 165, 198), cv2.FONT_HERSHEY_DUPLEX, .76, (245, 246, 248), 1, cv2.LINE_AA)

    cv2.putText(view, "EAR ACTIVITY", (x + 22, 238), cv2.FONT_HERSHEY_SIMPLEX, .4, (161, 170, 182), 1, cv2.LINE_AA)
    cv2.putText(view, f"{len(blinks)} / 60 sec", (x + 22, 264), cv2.FONT_HERSHEY_SIMPLEX, .55, (220, 225, 232), 1, cv2.LINE_AA)
    chart = (x + 22, 286, x + panel_width - 22, min(height - 72, 390))
    cv2.rectangle(view, (chart[0], chart[1]), (chart[2], chart[3]), (33, 38, 45), -1, cv2.LINE_AA)
    cv2.putText(view, "LIVE SIGNAL", (chart[0] + 10, chart[1] + 20), cv2.FONT_HERSHEY_SIMPLEX, .34, (145, 155, 168), 1, cv2.LINE_AA)
    points = list(ear_history)[-100:]
    if len(points) > 1 and chart[3] - chart[1] > 40:
        plot_top, plot_bottom = chart[1] + 31, chart[3] - 10
        graph = [((chart[0] + 8 + int(i * (chart[2] - chart[0] - 16) / (len(points) - 1))), int(plot_bottom - min(max(v, 0), .5) / .5 * (plot_bottom - plot_top))) for i, v in enumerate(points)]
        for a, b in zip(graph, graph[1:]):
            cv2.line(view, a, b, color, 2, cv2.LINE_AA)
        marker_x = chart[0] + 8 + int((now * 30) % max(1, chart[2] - chart[0] - 16))
        cv2.line(view, (marker_x, plot_top), (marker_x, plot_bottom), (55, 63, 72), 1, cv2.LINE_AA)

    cv2.putText(view, "Q QUIT  SPACE MONITOR  A SOUND  C CALIBRATE", (x + 12, height - 24), cv2.FONT_HERSHEY_SIMPLEX, .34, (160, 170, 182), 1, cv2.LINE_AA)
    return view


def main() -> int:
    settings = parse_args()
    model_path = Path(__file__).parent / "models" / "face_landmarker.task"
    if not model_path.is_file():
        print(f"Face landmark model not found: {model_path}", file=sys.stderr)
        return 1
    journal = SessionJournal(Path(__file__).parent / "reports" / "sessions")
    camera = cv2.VideoCapture(settings.camera)
    if not camera.isOpened():
        camera.release()
        print(f"Could not open webcam {settings.camera}. Check camera permissions or choose --camera INDEX.", file=sys.stderr)
        journal.record_event("camera_error", reason=f"Could not open webcam {settings.camera}")
        try: journal.finish()
        except OSError as exc: print(f"Could not save session report: {exc}", file=sys.stderr)
        return 1
    state = DrowsinessState(settings)
    ear_history = deque(maxlen=100)
    report_path = Path(__file__).parent / "reports" / "drowsiness_events.csv"
    ear, mouth = 1.0, 0.0
    alarm_played_for = "Monitoring"
    alarm_process = None
    monitoring = True
    calibration_samples = []
    calibration_until = 0.0
    started_at = time.monotonic()
    last_timestamp_ms = -1
    try:
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=settings.face_confidence,
            min_face_presence_confidence=settings.face_confidence,
            min_tracking_confidence=settings.face_confidence,
        )
        with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
            while True:
                if monitoring:
                    ok, frame = camera.read()
                else:
                    frame = None
                    ok = False
                if not monitoring:
                    frame = cv2.putText(np.zeros((480, 640, 3), dtype="uint8"), "MONITORING OFF - press SPACE to start", (36, 240), cv2.FONT_HERSHEY_SIMPLEX, .8, (235, 235, 235), 2)
                    status = "Monitoring OFF"
                    ear, mouth = 0.0, 0.0
                    now = time.monotonic()
                    cv2.imshow("Vigil | Driver Drowsiness Monitor", render_dashboard(frame, status, ear, mouth, state.blinks, now, ear_history))
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), 27): break
                    if key == ord(" "):
                        camera = cv2.VideoCapture(settings.camera)
                        if camera.isOpened():
                            monitoring = True; journal.set_monitoring(True); state = DrowsinessState(settings)
                        else:
                            camera.release(); journal.record_event("camera_error", reason="Could not reopen camera")
                    continue
                if not ok:
                    journal.record_event("camera_error", reason="Webcam stopped returning frames")
                    print("Webcam stopped returning frames.", file=sys.stderr)
                    return 1
                frame = cv2.flip(frame, 1)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                now = time.monotonic()
                timestamp_ms = max(last_timestamp_ms + 1, int((now - started_at) * 1000))
                last_timestamp_ms = timestamp_ms
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect_for_video(image, timestamp_ms)
                if result.face_landmarks:
                    landmarks = result.face_landmarks[0]
                    try:
                        ear, mouth = facial_metrics(landmarks, frame.shape[1], frame.shape[0])
                        status = state.update(ear, mouth, now)
                    except (ValueError, AttributeError, TypeError):
                        state.missed_face(); status = state.alert; ear, mouth = 0.0, 0.0
                        journal.record_event("detection_interruption", reason="Unreliable facial landmarks")
                    ear_history.append(ear)
                    if calibration_until and now <= calibration_until and ear >= settings.ear_threshold:
                        calibration_samples.append(ear)
                    elif calibration_until:
                        calibration_until = 0
                        try:
                            state.calibrate(calibration_samples)
                            journal.record_event("calibration_completed", threshold=state.active_ear_threshold)
                        except ValueError as exc:
                            journal.record_event("calibration_failed", reason=str(exc))
                        calibration_samples.clear()
                    for indices in (LEFT_EYE, RIGHT_EYE):
                        pts = [tuple(map(int, (landmarks[i].x * frame.shape[1], landmarks[i].y * frame.shape[0]))) for i in indices]
                        for point in pts:
                            cv2.circle(frame, point, 2, (80, 220, 180), -1)
                        center = (sum(p[0] for p in pts) // len(pts), sum(p[1] for p in pts) // len(pts))
                        ring_color = (65, 75, 245) if ear < settings.ear_threshold else (80, 220, 180)
                        cv2.circle(frame, center, 7 + int((math.sin(now * 5) + 1) * 2), ring_color, 1, cv2.LINE_AA)
                    mouth_points = [tuple(map(int, (landmarks[i].x * frame.shape[1], landmarks[i].y * frame.shape[0]))) for i in (MOUTH_TOP, MOUTH_BOTTOM)]
                    cv2.line(frame, *mouth_points, (80, 220, 180), 1, cv2.LINE_AA)
                else:
                    state.missed_face()
                    ear_history.clear()
                    ear, mouth = 1.0, 0.0
                    status = state.alert
                    if status != alarm_played_for:
                        journal.record_event("detection_interruption", reason=status)
                if ("WARNING" in status or "ALARM" in status) and status != alarm_played_for:
                    try:
                        write_alert_record(report_path, status, ear, mouth, len(state.blinks), settings)
                    except OSError as exc:
                        print(f"Could not save event report: {exc}", file=sys.stderr)
                    journal.record_event("alarm" if "ALARM" in status else "warning", status=status, ear=ear, mouth_opening_px=mouth)
                cv2.imshow("Vigil | Driver Drowsiness Monitor", render_dashboard(frame, status, ear, mouth, state.blinks, now, ear_history))
                if settings.alarm and ("WARNING" in status or "ALARM" in status) and status != alarm_played_for:
                    alarm_process = play_alarm()
                elif "WARNING" not in status and "ALARM" not in status:
                    stop_alarm(alarm_process); alarm_process = None
                alarm_played_for = status
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q") or key == 27:
                    break
                if key == ord("a"):
                    settings.alarm = not settings.alarm
                    journal.record_event("sound_enabled" if settings.alarm else "sound_disabled")
                    if not settings.alarm: stop_alarm(alarm_process); alarm_process = None
                if key == ord("c"):
                    calibration_samples.clear(); calibration_until = time.monotonic() + 3
                if key == ord(" "):
                    monitoring = False; journal.set_monitoring(False); camera.release(); stop_alarm(alarm_process); alarm_process = None
    except (cv2.error, RuntimeError) as exc:
        print(f"Video processing failed: {exc}", file=sys.stderr)
        return 1
    finally:
        camera.release()
        stop_alarm(alarm_process)
        cv2.destroyAllWindows()
        try:
            print(f"Session report: {journal.finish()}")
        except OSError as exc:
            print(f"Could not save session report: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
