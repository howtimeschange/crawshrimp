import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from core import api_server


class ApiTaskLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_task_background_marks_early_crash_as_error_and_clears_control(self):
        jid = "temu::tax_free_return_confirm"
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()

        try:
            api_server._run_status[jid] = {"status": "running", "run_id": None, "records": 0}
            api_server._run_logs[jid] = []
            api_server._run_controls[jid] = run_control

            with patch(
                "core.api_server._execute_task",
                new=AsyncMock(side_effect=RuntimeError("boom before begin_run")),
            ):
                await api_server._run_task_background(
                    "temu",
                    "tax_free_return_confirm",
                    {},
                    {},
                    run_control,
                )

            self.assertEqual(api_server._run_status[jid]["status"], "error")
            self.assertIsNone(api_server._run_status[jid]["run_id"])
            self.assertEqual(api_server._run_status[jid]["records"], 0)
            self.assertIn("boom before begin_run", api_server._run_status[jid]["error"])
            self.assertNotIn(jid, api_server._run_controls)
            self.assertTrue(any("FATAL" in line for line in api_server._run_logs[jid]))
        finally:
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)


if __name__ == "__main__":
    unittest.main()
