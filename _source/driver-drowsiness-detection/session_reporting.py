"""Atomic, local-only JSON session summaries."""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import uuid


def timestamp(at: datetime | None = None) -> datetime:
    return (at or datetime.now().astimezone()).astimezone()


class SessionJournal:
    def __init__(self, directory: Path, monitoring: bool = True, started_at: datetime | None = None):
        start = timestamp(started_at)
        self.path = directory / f"session-{start.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}.json"
        self.started = start
        self.enabled = monitoring
        self.enabled_at = start if monitoring else None
        self.document = {
            "session_id": self.path.stem,
            "started_at": start.isoformat(timespec="seconds"),
            "ended_at": None,
            "duration_seconds": None,
            "monitoring_periods": [],
            "events": [],
        }
        self.event_ids: set[str] = set()

    def set_monitoring(self, enabled: bool, at: datetime | None = None) -> None:
        if enabled == self.enabled:
            return
        when = timestamp(at)
        self.enabled = enabled
        if enabled:
            self.enabled_at = when
        else:
            if self.enabled_at is not None:
                self.document["monitoring_periods"].append({
                    "started_at": self.enabled_at.isoformat(timespec="seconds"),
                    "ended_at": when.isoformat(timespec="seconds"),
                    "duration_seconds": max(0, (when - self.enabled_at).total_seconds()),
                })
            self.enabled_at = None

    def record_event(self, event_type: str, at: datetime | None = None, event_id: str | None = None, **details) -> bool:
        if event_id is not None and event_id in self.event_ids:
            return False
        if event_id is not None:
            self.event_ids.add(event_id)
        self.document["events"].append({
            "event_id": event_id or uuid.uuid4().hex,
            "type": event_type,
            "timestamp": timestamp(at).isoformat(timespec="seconds"),
            **details,
        })
        return True

    def finish(self, at: datetime | None = None) -> Path:
        end = timestamp(at)
        self.set_monitoring(False, end)
        self.document["ended_at"] = end.isoformat(timespec="seconds")
        self.document["duration_seconds"] = max(0, (end - self.started).total_seconds())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent, delete=False) as report:
                temp_path = Path(report.name)
                json.dump(self.document, report, indent=2)
                report.write("\n")
                report.flush()
                os.fsync(report.fileno())
            os.replace(temp_path, self.path)
        except OSError:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            raise
        return self.path
