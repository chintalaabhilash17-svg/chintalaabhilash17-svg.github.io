"""Append alert events to a local CSV report without storing camera frames."""
from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from detector import Settings


def write_alert_record(path: Path, status: str, ear: float, mouth_px: float, ear_changes: int, settings: Settings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", newline="", encoding="utf-8") as report:
        writer = csv.writer(report)
        if write_header:
            writer.writerow(("timestamp", "alert", "ear", "mouth_opening_px", "ear_changes_60s", "ear_threshold", "mouth_threshold_px"))
        writer.writerow((datetime.now().astimezone().isoformat(timespec="seconds"), status, f"{ear:.4f}", f"{mouth_px:.1f}", ear_changes, settings.ear_threshold, settings.mouth_opening_px))
