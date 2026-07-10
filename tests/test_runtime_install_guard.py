import threading
import unittest

from core.runtime_install_guard import (
    InstallRuntimeBusy,
    RuntimeInstallGuard,
    UpdateDrainActive,
)


class RuntimeInstallGuardTests(unittest.TestCase):
    def test_fresh_guard_starts_ready_and_undrained(self):
        guard = RuntimeInstallGuard()

        readiness = guard.readiness()

        self.assertTrue(readiness["ready"])
        self.assertFalse(readiness["draining"])
        self.assertEqual(readiness["blockers"], [])
        self.assertIn("+00:00", readiness["checked_at"])
        self.assertFalse(guard.is_draining())
        guard.assert_start_allowed()

    def test_begin_operation_registers_normalized_blocker_until_token_ends(self):
        guard = RuntimeInstallGuard()

        token = guard.begin_operation("task", "tmall::export", "天猫导出", status="syncing")
        readiness = guard.readiness()

        self.assertFalse(readiness["ready"])
        self.assertFalse(readiness["draining"])
        self.assertEqual(
            readiness["blockers"],
            [
                {
                    "kind": "task",
                    "id": "tmall::export",
                    "label": "天猫导出",
                    "status": "syncing",
                }
            ],
        )
        self.assertTrue(guard.end_operation(token))
        self.assertTrue(guard.readiness()["ready"])

    def test_begin_operation_returns_duplicate_safe_tokens_for_same_operation(self):
        guard = RuntimeInstallGuard()

        first = guard.begin_operation("task", "tmall::export", "天猫导出")
        second = guard.begin_operation("task", "tmall::export", "天猫导出")

        self.assertNotEqual(first, second)
        self.assertEqual(len(guard.readiness()["blockers"]), 2)
        self.assertTrue(guard.end_operation(first))
        self.assertFalse(guard.readiness()["ready"])
        self.assertTrue(guard.end_operation(second))
        self.assertTrue(guard.readiness()["ready"])

    def test_acquire_drain_rejects_active_operations_with_exception_blockers(self):
        guard = RuntimeInstallGuard()
        token = guard.begin_operation(None, None, None, status=None)

        with self.assertRaises(InstallRuntimeBusy) as raised:
            guard.acquire_drain(extra_blockers=[{"kind": "external", "id": "claim-1", "label": "云端任务"}])

        blockers = raised.exception.blockers
        self.assertEqual(len(blockers), 2)
        self.assertEqual(blockers[0]["kind"], "operation")
        self.assertEqual(blockers[0]["id"], token)
        self.assertEqual(blockers[0]["label"], "后台操作")
        self.assertEqual(blockers[0]["status"], "running")
        self.assertEqual(
            blockers[1],
            {"kind": "external", "id": "claim-1", "label": "云端任务", "status": "running"},
        )
        self.assertFalse(guard.is_draining())

    def test_acquire_drain_rejects_extra_blockers_without_entering_drain(self):
        guard = RuntimeInstallGuard()

        with self.assertRaises(InstallRuntimeBusy) as raised:
            guard.acquire_drain(extra_blockers=[{"id": "schedule-1"}])

        self.assertEqual(
            raised.exception.blockers,
            [{"kind": "operation", "id": "schedule-1", "label": "schedule-1", "status": "running"}],
        )
        self.assertFalse(guard.is_draining())

    def test_drain_blocks_new_operations_until_matching_token_releases(self):
        guard = RuntimeInstallGuard()
        drain_token = guard.acquire_drain()

        with self.assertRaises(UpdateDrainActive):
            guard.begin_operation("task", "tmall::export", "天猫导出")

        self.assertFalse(guard.release_drain("wrong-token"))
        self.assertTrue(guard.is_draining())
        self.assertTrue(guard.release_drain(drain_token))
        operation_token = guard.begin_operation("task", "tmall::export", "天猫导出")
        self.assertTrue(guard.end_operation(operation_token))

    def test_assert_start_allowed_rejects_during_drain(self):
        guard = RuntimeInstallGuard()
        guard.acquire_drain()

        with self.assertRaises(UpdateDrainActive):
            guard.assert_start_allowed()

    def test_release_and_end_ignore_unknown_tokens(self):
        guard = RuntimeInstallGuard()

        self.assertFalse(guard.release_drain("missing"))
        self.assertFalse(guard.end_operation("missing"))

    def test_drain_acquisition_is_atomic_against_operation_start(self):
        guard = RuntimeInstallGuard()
        barrier = threading.Barrier(2)
        results = []
        lock = threading.Lock()

        def record(result):
            with lock:
                results.append(result)

        def begin_operation():
            barrier.wait()
            try:
                token = guard.begin_operation("task", "race", "竞态任务")
                record(("operation", token))
            except UpdateDrainActive:
                record(("operation_rejected", None))

        def acquire_drain():
            barrier.wait()
            try:
                token = guard.acquire_drain()
                record(("drain", token))
            except InstallRuntimeBusy as exc:
                record(("busy", exc.blockers))

        threads = [threading.Thread(target=begin_operation), threading.Thread(target=acquire_drain)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        kinds = {kind for kind, _ in results}
        self.assertIn(kinds, [{"operation", "busy"}, {"operation_rejected", "drain"}])
        readiness = guard.readiness()
        self.assertNotEqual(readiness["ready"], readiness["draining"])
