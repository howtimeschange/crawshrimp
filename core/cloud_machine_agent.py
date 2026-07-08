"""Desktop machine agent for cloud approval worker jobs."""
from __future__ import annotations

import platform
import time
import uuid
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
    ):
        self.client = client
        self.sleep = sleep
        self.now = now
        self.app_version = str(app_version or "")
        self.machine_id_factory = machine_id_factory or self._default_machine_id
        self.fingerprint_factory = fingerprint_factory or self._default_fingerprint
        self.job_executor_factory = job_executor_factory or (lambda client: CloudJobExecutor(client))
        self.heartbeat_callback = heartbeat_callback

    def enroll(self, registration_token: str, machine_name: str, capabilities: list[str]) -> dict:
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

    def claim_once(self) -> dict:
        response = self._request_machine_json("POST", "/api/machines/jobs/claim", {})
        job = response.get("job")
        next_poll = self._coerce_sleep_seconds(response.get("next_poll_after_seconds"), DEFAULT_IDLE_SECONDS)
        job_result = None
        if isinstance(job, Mapping):
            job_result = self._execute_claimed_job(job)
        idle_sleep = next_poll if job_result else self._idle_sleep_seconds(next_poll)
        return {
            **response,
            "job": job,
            "job_result": job_result,
            "next_poll_after_seconds": next_poll,
            "idle_sleep_seconds": idle_sleep,
        }

    def run_forever(self, stop_event) -> None:
        failure_count = 0
        while not stop_event.is_set():
            try:
                self.heartbeat("online_idle")
                result = self.claim_once()
            except CloudApprovalError as exc:
                self._clear_credentials_if_revoked(exc)
                sleep_seconds = self._failure_backoff_seconds(failure_count)
                failure_count += 1
                self.sleep(sleep_seconds)
                continue
            failure_count = 0
            self.sleep(float(result.get("idle_sleep_seconds") or DEFAULT_IDLE_SECONDS))

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
        try:
            self._complete_job(job, result.get("result") if isinstance(result, Mapping) else result)
        except CloudApprovalError as exc:
            if self._is_stale_lease_error(exc):
                return {"status": "stale_lease", "message": str(exc)}
            raise
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

    @staticmethod
    def _clear_credentials_if_revoked(exc: CloudApprovalError) -> None:
        text = str(exc).lower()
        if "http 401" in text and "machine_token_revoked" in text:
            data_sink.clear_cloud_machine_credentials()

    @staticmethod
    def _is_stale_lease_error(exc: CloudApprovalError) -> bool:
        return "stale lease" in str(exc).lower()

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
        return str(uuid.uuid4())

    @staticmethod
    def _default_fingerprint() -> str:
        parts = [platform.node(), platform.machine(), platform.system()]
        return ":".join(part for part in parts if part)
