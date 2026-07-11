"""Desktop machine agent for cloud approval worker jobs."""
from __future__ import annotations

import platform
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping

from core import data_sink
from core.cloud_approval_client import CloudApprovalClient, CloudApprovalError
from core.cloud_job_executors import CloudJobBlocked, CloudJobCancelled, CloudJobExecutor, CloudJobTerminalFailure


DEFAULT_IDLE_SECONDS = 45.0
FAILURE_BACKOFF_SECONDS = (10.0, 30.0, 60.0, 120.0)


class CloudMachineAgent:
    def __init__(
        self,
        client: CloudApprovalClient,
        *,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.time,
        app_version: str = "",
        machine_id_factory: Callable[[], str] | None = None,
        fingerprint_factory: Callable[[], str] | None = None,
        job_executor_factory: Callable[[CloudApprovalClient], Any] | None = None,
        heartbeat_callback: Callable[[str], None] | None = None,
        begin_job_operation: Callable[[], str] | None = None,
        end_job_operation: Callable[[str], None] | None = None,
    ):
        self.client = client
        self.sleep = sleep
        self.now = now
        self.app_version = str(app_version or "")
        self.machine_id_factory = machine_id_factory or self._default_machine_id
        self.fingerprint_factory = fingerprint_factory or self._default_fingerprint
        self.job_executor_factory = job_executor_factory or (lambda client: CloudJobExecutor(client))
        self.heartbeat_callback = heartbeat_callback
        self.begin_job_operation = begin_job_operation
        self.end_job_operation = end_job_operation

    def enroll(self, registration_token: str, machine_name: str, capabilities: list[str]) -> dict:
        saved = data_sink.get_cloud_machine_credentials() or {}
        saved_machine_id = str(saved.get("machine_id") or "")
        saved_machine_token = str(saved.get("machine_token") or "")
        if saved_machine_id and saved_machine_token:
            self._set_client_machine_token(saved_machine_token)
            return {
                "machine_id": saved_machine_id,
                "auth_status": "enrolled",
                "already_enrolled": True,
            }
        capability_list = list(capabilities or [])
        response = self.client.request_json(
            "POST",
            "/api/machines/enroll",
            {
                "enrollment_token": registration_token,
                "machine_id": self.machine_id_factory(),
                "machine_name": machine_name,
                "fingerprint": self.fingerprint_factory(),
                "app_version": self.app_version,
                "capabilities": capability_list,
            },
        )
        machine_id = str(response.get("machine_id") or "")
        machine_token = str(response.get("machine_token") or "")
        if machine_id and machine_token:
            data_sink.save_cloud_machine_credentials(
                machine_id=machine_id,
                machine_token=machine_token,
                machine_name=str(machine_name or ""),
                capabilities=capability_list,
            )
            self._set_client_machine_token(machine_token)
        return response

    def heartbeat(
        self,
        health: str,
        current_job_id: str = "",
        capabilities: list[str] | None = None,
    ) -> dict:
        saved = self._load_credentials()
        capability_list = list(capabilities if capabilities is not None else saved.get("capabilities") or [])
        response = self._request_machine_json(
            "POST",
            "/api/machines/heartbeat",
            {
                "health": health,
                "current_job_id": current_job_id,
                "app_version": self.app_version,
                "capabilities": capability_list,
            },
        )
        if self.heartbeat_callback is not None:
            self.heartbeat_callback(str(response.get("health") or health or ""))
        return response

    def claim_once(self, *, flush_pending: bool = True) -> dict:
        operation_token = ""
        if self.begin_job_operation is not None:
            operation_token = str(self.begin_job_operation() or "")
            if not operation_token:
                return {
                    "job": None,
                    "job_result": None,
                    "next_poll_after_seconds": DEFAULT_IDLE_SECONDS,
                    "idle_sleep_seconds": DEFAULT_IDLE_SECONDS,
                }
        try:
            if flush_pending:
                self.flush_pending_completions()
            response = self._request_machine_json("POST", "/api/machines/jobs/claim", {})
            job = response.get("job")
            next_poll = self._coerce_sleep_seconds(response.get("next_poll_after_seconds"), DEFAULT_IDLE_SECONDS)
            job_result = None
            if isinstance(job, Mapping):
                if self.heartbeat_callback is not None:
                    self.heartbeat_callback("online_busy")
                job_result = self._execute_claimed_job(job)
                if self.heartbeat_callback is not None and str((job_result or {}).get("status") or "") != "blocked_needs_login":
                    self.heartbeat_callback("online_idle")
            idle_sleep = next_poll if job_result else self._idle_sleep_seconds(next_poll)
            return {
                **response,
                "job": job,
                "job_result": job_result,
                "next_poll_after_seconds": next_poll,
                "idle_sleep_seconds": idle_sleep,
            }
        finally:
            if operation_token and self.end_job_operation is not None:
                self.end_job_operation(operation_token)

    def run_forever(self, stop_event) -> None:
        failure_count = 0
        while not stop_event.is_set():
            try:
                self.flush_pending_completions()
                self.heartbeat("online_idle")
                result = self.claim_once(flush_pending=False)
            except CloudApprovalError as exc:
                self._clear_credentials_if_revoked(exc)
                sleep_seconds = self._failure_backoff_seconds(failure_count)
                failure_count += 1
                self.sleep(sleep_seconds)
                continue
            failure_count = 0
            self.sleep(float(result.get("idle_sleep_seconds") or DEFAULT_IDLE_SECONDS))

    def flush_pending_completions(self, limit: int = 20) -> dict:
        summary = {"completed": 0, "stale": 0, "rescheduled": 0, "discarded": 0}
        for entry in data_sink.list_pending_cloud_job_completions(limit=limit):
            job_uid = str(entry.get("job_uid") or "")
            lease_id = str(entry.get("lease_id") or "")
            result = entry.get("result") if isinstance(entry.get("result"), Mapping) else {}
            if not lease_id:
                data_sink.record_cloud_job_event(
                    job_uid,
                    "completion_unreplayable",
                    "pending completion has no persisted lease",
                    {"reason": "missing_lease_id"},
                )
                data_sink.clear_pending_cloud_job_completion(job_uid)
                summary["discarded"] += 1
                continue
            try:
                self._request_machine_json("POST", f"/api/jobs/{job_uid}/complete", {
                    "job_uid": job_uid,
                    "lease_id": lease_id,
                    "result": dict(result),
                })
            except CloudApprovalError as exc:
                if self._is_invalid_machine_token_error(exc):
                    raise
                if self._is_stale_lease_error(exc):
                    data_sink.record_cloud_job_event(
                        job_uid,
                        "completion_stale_lease",
                        "pending completion lease is no longer current",
                        {"lease_id": lease_id},
                    )
                    data_sink.clear_pending_cloud_job_completion(job_uid)
                    summary["stale"] += 1
                    continue
                attempt_count = int(entry.get("attempt_count") or 0)
                delay = FAILURE_BACKOFF_SECONDS[
                    min(max(attempt_count, 0), len(FAILURE_BACKOFF_SECONDS) - 1)
                ]
                next_attempt_at = (
                    datetime.fromtimestamp(float(self.now()), tz=timezone.utc) + timedelta(seconds=delay)
                ).isoformat()
                error = str(exc)
                data_sink.mark_pending_cloud_job_completion_attempt(job_uid, error, next_attempt_at)
                data_sink.record_cloud_job_event(
                    job_uid,
                    "completion_retry_scheduled",
                    error,
                    {"attempt_count": attempt_count + 1, "next_attempt_at": next_attempt_at},
                )
                summary["rescheduled"] += 1
                continue
            data_sink.record_cloud_job_event(
                job_uid,
                "completion_replayed",
                "pending completion delivered",
                {"lease_id": lease_id},
            )
            data_sink.clear_pending_cloud_job_completion(job_uid)
            summary["completed"] += 1
        return summary

    def _request_machine_json(self, method: str, path: str, body: Mapping[str, Any]) -> dict:
        self._load_credentials()
        try:
            return self.client.request_json(method, path, body)
        except CloudApprovalError as exc:
            self._clear_credentials_if_revoked(exc)
            raise

    def _execute_claimed_job(self, job: Mapping[str, Any]) -> dict:
        executor = self.job_executor_factory(self.client)
        try:
            result = executor.execute(job)
        except CloudJobCancelled as exc:
            payload = {"status": "cancelled", "message": str(exc) or "cloud job cancellation requested"}
            self._fail_job(job, payload, terminal=True)
            return payload
        except CloudJobBlocked as exc:
            payload = {"status": f"blocked_{exc.status}", "message": exc.message}
            if exc.status == "needs_login" and self.heartbeat_callback is not None:
                self.heartbeat_callback("needs_login")
            self._fail_job(job, payload, terminal=False)
            return payload
        except CloudJobTerminalFailure as exc:
            payload = {"status": "terminal_failed", "message": str(exc)}
            self._fail_job(job, payload, terminal=True)
            return payload
        except Exception as exc:
            payload = {"status": "retryable_failed", "message": str(exc)}
            self._fail_job(job, payload, terminal=False)
            return payload
        complete_result = result.get("result") if isinstance(result, Mapping) else result
        try:
            self._complete_job(job, complete_result)
        except CloudApprovalError as exc:
            if self._is_stale_lease_error(exc):
                data_sink.record_cloud_job_event(
                    self._job_uid(job),
                    "completion_stale_lease",
                    "completion rejected because the lease is stale",
                    {"lease_id": self._lease_id(job)},
                )
                return {"status": "stale_lease", "message": str(exc)}
            data_sink.save_pending_cloud_job_completion(
                self._job_uid(job),
                self._lease_id(job),
                complete_result,
                last_error=str(exc),
            )
            return {"status": "completion_pending", "message": str(exc)}
        data_sink.clear_pending_cloud_job_completion(self._job_uid(job))
        if isinstance(result, Mapping):
            return dict(result)
        return {"status": "succeeded", "result": result}

    def _complete_job(self, job: Mapping[str, Any], result: Any) -> dict:
        return self._request_machine_json("POST", f"/api/jobs/{self._job_uid(job)}/complete", {
            "job_uid": self._job_uid(job),
            "lease_id": self._lease_id(job),
            "result": result if isinstance(result, Mapping) else {"value": result},
        })

    def _fail_job(self, job: Mapping[str, Any], result: Mapping[str, Any], *, terminal: bool) -> dict:
        return self._request_machine_json("POST", f"/api/jobs/{self._job_uid(job)}/fail", {
            "job_uid": self._job_uid(job),
            "lease_id": self._lease_id(job),
            "terminal": terminal,
            "status": str(result.get("status") or ""),
            "message": str(result.get("message") or result.get("status") or ""),
            "result": dict(result),
        })

    def _load_credentials(self) -> dict:
        saved = data_sink.get_cloud_machine_credentials() or {}
        machine_token = str(saved.get("machine_token") or "")
        if machine_token:
            self._set_client_machine_token(machine_token)
        return saved

    def _set_client_machine_token(self, machine_token: str) -> None:
        if hasattr(self.client, "machine_token"):
            self.client.machine_token = machine_token

    @staticmethod
    def _job_uid(job: Mapping[str, Any]) -> str:
        return str(job.get("job_uid") or "")

    @staticmethod
    def _lease_id(job: Mapping[str, Any]) -> str:
        return str(job.get("lease_id") or "")

    def _clear_credentials_if_revoked(self, exc: CloudApprovalError) -> None:
        text = str(exc).lower()
        payload = getattr(exc, "payload", {}) or {}
        code = str(payload.get("code") or "").lower()
        status = int(getattr(exc, "status", 0) or 0)
        coded_invalid = status == 401 and code == "machine_token_invalid"
        compatible_invalid = "http 401" in text and (
            "machine_token_revoked" in text or "invalid machine token" in text
        )
        if coded_invalid or compatible_invalid:
            data_sink.clear_cloud_machine_credentials()
            self._set_client_machine_token("")

    @staticmethod
    def _is_stale_lease_error(exc: CloudApprovalError) -> bool:
        payload = getattr(exc, "payload", {}) or {}
        code = str(payload.get("code") or "").lower()
        return code in {"stale_lease", "job_lease_stale"} or "stale lease" in str(exc).lower()

    @staticmethod
    def _is_invalid_machine_token_error(exc: CloudApprovalError) -> bool:
        payload = getattr(exc, "payload", {}) or {}
        code = str(payload.get("code") or "").lower()
        text = str(exc).lower()
        return (
            int(getattr(exc, "status", 0) or 0) == 401
            and (code == "machine_token_invalid" or "invalid machine token" in text or "machine_token_revoked" in text)
        )

    @staticmethod
    def _failure_backoff_seconds(failure_count: int) -> float:
        index = min(max(failure_count, 0), len(FAILURE_BACKOFF_SECONDS) - 1)
        return FAILURE_BACKOFF_SECONDS[index]

    @staticmethod
    def _coerce_sleep_seconds(value: Any, default: float) -> float:
        try:
            seconds = float(value)
        except (TypeError, ValueError):
            return float(default)
        return seconds if seconds > 0 else 0.0

    @staticmethod
    def _idle_sleep_seconds(next_poll: float) -> float:
        return next_poll if next_poll > 0 else DEFAULT_IDLE_SECONDS

    @staticmethod
    def _default_machine_id() -> str:
        return "csr-machine-" + hashlib.sha256(CloudMachineAgent._default_fingerprint().encode("utf-8")).hexdigest()[:20]

    @staticmethod
    def _default_fingerprint() -> str:
        parts = [platform.node(), platform.machine(), platform.system(), str(uuid.getnode())]
        return ":".join(part for part in parts if part)
