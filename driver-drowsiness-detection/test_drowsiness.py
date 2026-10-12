import unittest
import csv
import tempfile
from pathlib import Path
from types import SimpleNamespace

from detector import DrowsinessState, Settings, eye_aspect_ratio, facial_metrics
from reporting import write_alert_record
from session_reporting import SessionJournal
from datetime import datetime, timezone


class DetectorTests(unittest.TestCase):
    def test_alert_report_appends_rows_with_one_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reports" / "events.csv"
            settings = Settings()
            write_alert_record(path, "YAWNING ALERT", .3, 31, 0, settings)
            write_alert_record(path, "DROWSINESS ALERT", .2, 12, 3, settings)
            with path.open(newline="", encoding="utf-8") as report:
                rows = list(csv.reader(report))
            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[0][0], "timestamp")
            self.assertEqual(rows[1][1], "YAWNING ALERT")
            self.assertEqual(rows[2][1], "DROWSINESS ALERT")

    def test_ear_open_and_closed(self):
        open_eye = [(0, 1), (1, .5), (2, .5), (4, 1), (2, 1.5), (1, 1.5)]
        closed_eye = [(0, 1), (1, .95), (2, .95), (4, 1), (2, 1.05), (1, 1.05)]
        self.assertGreater(eye_aspect_ratio(open_eye), .20)
        self.assertLess(eye_aspect_ratio(closed_eye), .25)

    def test_ear_handles_narrow_and_wide_eye_geometry(self):
        narrow_eye = [(0, 1), (1, .65), (2, .65), (2, 1), (2, 1.35), (1, 1.35)]
        wide_eye = [(0, 1), (1, .3), (3, .3), (4, 1), (3, 1.7), (1, 1.7)]
        self.assertAlmostEqual(eye_aspect_ratio(narrow_eye), eye_aspect_ratio(wide_eye), places=5)

    def test_closure_warning_and_alarm_use_timestamps(self):
        state = DrowsinessState(Settings(closure_warning_seconds=2, closure_alarm_seconds=30))
        self.assertEqual(state.update(.1, 0, 0), "Monitoring")
        self.assertIn("WARNING", state.update(.1, 0, 2))
        self.assertIn("ALARM", state.update(.1, 0, 30))
        state.update(.3, 0, 31)
        self.assertEqual(state.alert, "Monitoring")

    def test_calibration_adapts_threshold_and_missing_face_resets_closure(self):
        state = DrowsinessState(Settings())
        threshold = state.calibrate([.4] * 10)
        self.assertAlmostEqual(threshold, .288)
        state.update(.1, 0, 0)
        state.missed_face()
        self.assertEqual(state.update(.1, 0, .1), "Monitoring")

    def test_blinks_and_face_unavailable_are_distinct(self):
        blink_state = DrowsinessState(Settings())
        for t, ear in enumerate((.3, .1, .3, .1, .3, .1)):
            blink_state.update(ear, 0, t * .1)
        self.assertIn("frequent eye changes", blink_state.alert)
        blink_state.update(.1, 0, 61)
        self.assertEqual(len(blink_state.blinks), 0)

    def test_missing_face_does_not_count_as_blink_or_continue_closure(self):
        state = DrowsinessState(Settings())
        state.update(.1, 0, 0)
        state.missed_face()
        self.assertEqual(len(state.blinks), 0)
        self.assertEqual(state.update(.1, 0, .1), "Monitoring")

    def test_yawn_duration(self):
        state = DrowsinessState(Settings(yawn_seconds=3))
        self.assertEqual(state.update(.3, 35, 0), "Monitoring")
        self.assertEqual(state.update(.3, 35, 3), "WARNING - sustained mouth opening")

    def test_bad_landmarks_rejected(self):
        with self.assertRaises(ValueError): eye_aspect_ratio([(0, 0)] * 5)

    def test_session_journal_records_periods_and_deduplicates_events(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            journal = SessionJournal(Path(directory), started_at=start)
            journal.record_event("warning", at=start, event_id="same")
            self.assertFalse(journal.record_event("warning", at=start, event_id="same"))
            journal.set_monitoring(False, start.replace(second=10))
            report = journal.finish(start.replace(second=20))
            document = __import__("json").loads(report.read_text())
            self.assertEqual(len(document["monitoring_periods"]), 1)
            self.assertEqual(len(document["events"]), 1)
            self.assertEqual(document["duration_seconds"], 20)

    def test_facial_metrics_uses_scaled_landmarks(self):
        coords = [SimpleNamespace(x=.5, y=.5) for _ in range(478)]
        coords[362] = SimpleNamespace(x=.4, y=.4); coords[263] = SimpleNamespace(x=.6, y=.4)
        coords[385] = SimpleNamespace(x=.45, y=.39); coords[373] = SimpleNamespace(x=.45, y=.41)
        coords[387] = SimpleNamespace(x=.55, y=.39); coords[380] = SimpleNamespace(x=.55, y=.41)
        coords[33] = SimpleNamespace(x=.4, y=.4); coords[133] = SimpleNamespace(x=.6, y=.4)
        coords[160] = SimpleNamespace(x=.45, y=.39); coords[153] = SimpleNamespace(x=.45, y=.41)
        coords[158] = SimpleNamespace(x=.55, y=.39); coords[144] = SimpleNamespace(x=.55, y=.41)
        coords[13] = SimpleNamespace(x=.5, y=.55); coords[14] = SimpleNamespace(x=.5, y=.58)
        ear, mouth = facial_metrics(coords, 640, 480)
        self.assertGreater(ear, 0)
        self.assertAlmostEqual(mouth, 14.4, places=5)


if __name__ == "__main__":
    unittest.main()
