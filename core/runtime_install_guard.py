from __future__ import annotations

from datetime import datetime, timezone
import threading
import uuid


class UpdateDrainActive(RuntimeError):
    """Raised when a runtime operation starts while update drain is active."""


class InstallRuntimeBusy(RuntimeError):
    """Raised when update drain cannot be acquired because work is active."""

    def __init__(self, blockers):
        self.blockers = list(blockers)
        super().__init__("install runtime is busy")


def _normalize_blocker(kind, operation_id, label, status, token):
    return {
        "kind": str(kind or "operation"),
        "id": str(operation_id or token),
        "label": str(label or operation_id or "后台操作"),
        "status": str(status or "running"),
    }


def _normalize_extra_blocker(blocker):
    if isinstance(blocker, dict):
        return _normalize_blocker(
            blocker.get("kind"),
            blocker.get("id") or blocker.get("operation_id"),
            blocker.get("label"),
            blocker.get("status"),
            uuid.uuid4().hex,
        )
    return _normalize_blocker(None, blocker, None, None, uuid.uuid4().hex)


class RuntimeInstallGuard:
    def __init__(self):
        self._lock = threading.RLock()
        self._active_operations = {}
        self._drain_token = None

    def begin_operation(self, kind, operation_id, label, status="running") -> str:
        with self._lock:
            if self._drain_token:
                raise UpdateDrainActive("update drain is active")
            token = uuid.uuid4().hex
            self._active_operations[token] = _normalize_blocker(kind, operation_id, label, status, token)
            return token

    def end_operation(self, token) -> bool:
        with self._lock:
            return self._active_operations.pop(token, None) is not None

    def readiness(self, extra_blockers=()) -> dict:
        with self._lock:
            blockers = self._blockers(extra_blockers)
            draining = bool(self._drain_token)
            return {
                "ready": len(blockers) == 0 and not draining,
                "draining": draining,
                "blockers": blockers,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }

    def acquire_drain(self, extra_blockers=()) -> str:
        with self._lock:
            if self._drain_token:
                raise UpdateDrainActive("update drain is active")
            blockers = self._blockers(extra_blockers)
            if blockers:
                raise InstallRuntimeBusy(blockers)
            self._drain_token = uuid.uuid4().hex
            return self._drain_token

    def release_drain(self, token) -> bool:
        with self._lock:
            if not self._drain_token or token != self._drain_token:
                return False
            self._drain_token = None
            return True

    def assert_start_allowed(self) -> None:
        with self._lock:
            if self._drain_token:
                raise UpdateDrainActive("update drain is active")

    def is_draining(self) -> bool:
        with self._lock:
            return bool(self._drain_token)

    def _blockers(self, extra_blockers):
        blockers = list(self._active_operations.values())
        blockers.extend(_normalize_extra_blocker(blocker) for blocker in extra_blockers)
        return blockers
