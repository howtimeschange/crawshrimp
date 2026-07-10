import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from core import ai_image_service, data_sink


class FakeWorkbenchClient:
    def __init__(self, *, barrier=None, fail_prompts=None, create_responses=None, poll_responses=None):
        self.barrier = barrier
        self.fail_prompts = set(fail_prompts or [])
        self.create_responses = list(create_responses or [])
        self.poll_responses = list(poll_responses or [])
        self.created_payloads = []
        self.create_lock = threading.Lock()
        self.get_calls = []

    def create_task(self, payload, *, idempotency_key, **_kwargs):
        prompt = str(payload.get("prompt") or "")
        with self.create_lock:
            self.created_payloads.append((dict(payload), idempotency_key))
        if self.barrier is not None:
            self.barrier.wait(timeout=2)
        if prompt in self.fail_prompts:
            raise RuntimeError(f"create failed for {prompt}")
        if self.create_responses:
            return self.create_responses.pop(0)
        suffix = prompt.replace(" ", "-") or "empty"
        return {
            "id": f"task-{suffix}",
            "status": "queued",
            "poll_url": f"https://api.example/images/tasks/task-{suffix}",
            "poll_after": 5,
        }

    def get_task(self, poll_url, **_kwargs):
        self.get_calls.append(poll_url)
        if not self.poll_responses:
            raise AssertionError("No poll response left")
        return self.poll_responses.pop(0)


class AiImageWorkbenchBatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()
        self.job = data_sink.create_ai_image_job({
            "title": "batch job",
            "model_key": "gpt-image-2",
            "prompt": "",
            "params": {
                "size": "1024x1024",
                "ratio": "1:1",
                "quality": "high",
                "response_format": "png",
                "n": 1,
                "model_key_tier": "2k",
            },
        })

    @staticmethod
    def _settings():
        return {"base_url": "https://api.example/v1", "2k": "unit-key", "4k": "unit-key-4k"}

    def test_batch_submits_all_prompts_concurrently_and_persists_task_handles(self):
        main_path = self.root / "main.png"
        ref_a_path = self.root / "ref-a.png"
        ref_b_path = self.root / "ref-b.png"
        for path in (main_path, ref_a_path, ref_b_path):
            path.write_bytes(b"test-image")
        expected_input_params = {
            "main_image_path": str(main_path),
            "reference_image_paths": [str(ref_a_path), str(ref_b_path)],
        }
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "params": {
                **self.job["params"],
                **expected_input_params,
            },
        })
        client = FakeWorkbenchClient(barrier=threading.Barrier(3))
        poll_submissions = []

        result = ai_image_service.submit_workbench_batch(
            self.job["job_uid"],
            [
                {"title": "A", "prompt": "one", "count": 3},
                {"title": "B", "prompt": "two", "count": 2},
                {"title": "C", "prompt": "three", "count": 1},
            ],
            request_uid="request-1",
            settings=self._settings(),
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda fn, *args, **kwargs: poll_submissions.append((fn, args, kwargs)),
        )

        self.assertTrue(result["accepted"])
        self.assertEqual(len(client.created_payloads), 3)
        self.assertEqual(len(poll_submissions), 3)
        payloads_by_prompt = {
            payload["prompt"]: payload
            for payload, _idempotency_key in client.created_payloads
        }
        self.assertEqual(payloads_by_prompt["one"]["n"], 3)
        self.assertEqual(payloads_by_prompt["two"]["n"], 2)
        self.assertEqual(payloads_by_prompt["three"]["n"], 1)
        self.assertEqual([run["prompt"] for run in result["runs"]], ["one", "two", "three"])
        self.assertEqual([run["batch_index"] for run in result["runs"]], [0, 1, 2])
        self.assertEqual([run["requested_count"] for run in result["runs"]], [3, 2, 1])
        self.assertTrue(all(run["task_id"] and run["poll_url"] for run in result["runs"]))
        self.assertTrue(all(run["poll_after"] == 5 for run in result["runs"]))
        self.assertTrue(all(run["input_params"] == expected_input_params for run in result["runs"]))

        refreshed = data_sink.get_ai_image_job(self.job["job_uid"])
        self.assertEqual(refreshed["status"], "running")
        self.assertEqual(len(refreshed["summary"]["runs"]), 3)
        self.assertEqual({run["request_uid"] for run in refreshed["summary"]["runs"]}, {"request-1"})

    def test_batch_accepts_100_rejects_101_and_deduplicates_request_uid(self):
        client = FakeWorkbenchClient()
        prompts = [{"title": f"P{index}", "prompt": f"prompt-{index}"} for index in range(100)]

        first = ai_image_service.submit_workbench_batch(
            self.job["job_uid"],
            prompts,
            request_uid="request-100",
            settings=self._settings(),
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda *_args, **_kwargs: None,
        )
        second = ai_image_service.submit_workbench_batch(
            self.job["job_uid"],
            prompts,
            request_uid="request-100",
            settings=self._settings(),
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda *_args, **_kwargs: None,
        )

        self.assertEqual(len(first["runs"]), 100)
        self.assertEqual(first["batch_uid"], second["batch_uid"])
        self.assertEqual(len(client.created_payloads), 100)
        with self.assertRaisesRegex(ValueError, "100"):
            ai_image_service.submit_workbench_batch(
                self.job["job_uid"],
                [*prompts, {"title": "overflow", "prompt": "overflow"}],
                request_uid="request-101",
                settings=self._settings(),
                client_factory=lambda *_args, **_kwargs: client,
                poll_submitter=lambda *_args, **_kwargs: None,
            )

    def test_batch_normalizes_gpt_counts_without_expanding_prompt_runs(self):
        client = FakeWorkbenchClient()
        result = ai_image_service.submit_workbench_batch(
            self.job["job_uid"],
            [
                {"prompt": "missing"},
                {"prompt": "zero", "count": 0},
                {"prompt": "large", "count": 99},
            ],
            request_uid="request-count-normalization",
            settings=self._settings(),
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda *_args, **_kwargs: None,
        )

        self.assertEqual([run["requested_count"] for run in result["runs"]], [1, 1, 8])
        self.assertEqual(len(client.created_payloads), 3)

    def test_nano_batch_forces_one_image_and_omits_n(self):
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "model_key": "gemini-3.1-flash-image-preview",
            "params": {
                "ratio": "1:1",
                "size": "2K",
                "quality": "2K",
                "n": 8,
            },
        })
        client = FakeWorkbenchClient()
        result = ai_image_service.submit_workbench_batch(
            self.job["job_uid"],
            [{"prompt": "nano", "count": 8}],
            request_uid="request-nano-count",
            settings={
                "base_url": "https://api.example/v1",
                ai_image_service.GEMINI_FLASH_CONFIG_ID: "unit-nano-key",
            },
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda *_args, **_kwargs: None,
        )

        payload = client.created_payloads[0][0]
        self.assertNotIn("n", payload)
        self.assertEqual(result["runs"][0]["requested_count"], 1)

    def test_single_create_failure_does_not_block_sibling_runs(self):
        client = FakeWorkbenchClient(fail_prompts={"two"})

        result = ai_image_service.submit_workbench_batch(
            self.job["job_uid"],
            [{"prompt": "one"}, {"prompt": "two"}, {"prompt": "three"}],
            request_uid="request-partial",
            settings=self._settings(),
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda *_args, **_kwargs: None,
        )

        self.assertEqual(len(client.created_payloads), 3)
        self.assertEqual([run["status"] for run in result["runs"]], ["queued", "failed", "queued"])
        self.assertIn("create failed for two", result["runs"][1]["error"])

    def test_poll_workbench_run_honors_poll_after_and_persists_completion(self):
        run_uid = "run-poll"
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "status": "running",
            "summary": {
                "runs": [{
                    "run_uid": run_uid,
                    "prompt": "one",
                    "requested_count": 2,
                    "status": "queued",
                    "provider_status": "queued",
                    "task_id": "task-one",
                    "poll_url": "https://api.example/images/tasks/task-one",
                    "poll_after": 5,
                    "image_urls": [],
                    "output_files": [],
                }],
            },
        })
        client = FakeWorkbenchClient(poll_responses=[
            {"id": "task-one", "status": "running", "poll_after": 2},
            {
                "id": "task-one",
                "status": "succeeded",
                "data": [
                    {"url": "https://img.example/task-one-a.png"},
                    {"url": "https://img.example/task-one-b.png"},
                    {"url": "https://img.example/task-one-extra.png"},
                ],
            },
        ])
        sleeps = []

        result = ai_image_service.poll_workbench_run(
            self.job["job_uid"],
            run_uid,
            client,
            sleep_fn=sleeps.append,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(sleeps, [5, 2])
        refreshed = data_sink.get_ai_image_job(self.job["job_uid"])
        run = refreshed["summary"]["runs"][0]
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["provider_status"], "succeeded")
        self.assertEqual(run["image_urls"], [
            "https://img.example/task-one-a.png",
            "https://img.example/task-one-b.png",
        ])
        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(refreshed["summary"]["image_urls"], [
            "https://img.example/task-one-a.png",
            "https://img.example/task-one-b.png",
        ])

    def test_poll_workbench_run_retries_transient_504_with_fresh_task(self):
        run_uid = "run-retry-504"
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "status": "running",
            "summary": {
                "runs": [{
                    "run_uid": run_uid,
                    "prompt": "retry product",
                    "requested_count": 2,
                    "model_key": "gpt-image-2",
                    "model_key_tier": "2k",
                    "size": "1024x1024",
                    "ratio": "1:1",
                    "quality": "high",
                    "response_format": "png",
                    "input_params": {"main_image_path": "", "reference_image_paths": []},
                    "status": "running",
                    "provider_status": "running",
                    "task_id": "task-original",
                    "poll_url": "https://api.example/images/tasks/task-original",
                    "poll_after": 5,
                    "retry_count": 0,
                    "retry_history": [],
                    "image_urls": [],
                    "output_files": [],
                }],
            },
        })
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "params": {
                "size": "2448x3264",
                "ratio": "3:4",
                "quality": "low",
                "response_format": "webp",
                "n": 1,
                "model_key_tier": "4k",
            },
        })
        client = FakeWorkbenchClient(
            create_responses=[{
                "id": "task-retry-1",
                "status": "queued",
                "poll_url": "https://api.example/images/tasks/task-retry-1",
                "poll_after": 3,
            }],
            poll_responses=[
                {"id": "task-original", "status": "failed", "message": "bad response status code 504"},
                {
                    "id": "task-retry-1",
                    "status": "succeeded",
                    "data": [
                        {"url": "https://img.example/retry-a.png"},
                        {"url": "https://img.example/retry-b.png"},
                    ],
                },
            ],
        )
        sleeps = []

        result = ai_image_service.poll_workbench_run(
            self.job["job_uid"],
            run_uid,
            client,
            sleep_fn=sleeps.append,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(sleeps, [5, 3])
        self.assertEqual(len(client.created_payloads), 1)
        retry_payload, retry_key = client.created_payloads[0]
        self.assertEqual(retry_payload["prompt"], "retry product")
        self.assertEqual(retry_payload["size"], "1024x1024")
        self.assertEqual(retry_payload["quality"], "high")
        self.assertEqual(retry_payload["output_format"], "png")
        self.assertEqual(retry_payload["n"], 2)
        self.assertTrue(retry_key.endswith("_retry_1"))
        run = data_sink.get_ai_image_job(self.job["job_uid"])["summary"]["runs"][0]
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["task_id"], "task-retry-1")
        self.assertEqual(run["retry_count"], 1)
        self.assertEqual(len(run["retry_history"]), 1)
        self.assertEqual(run["retry_history"][0]["task_id"], "task-original")
        self.assertIn("504", run["retry_history"][0]["error"])
        self.assertEqual(run["image_urls"], [
            "https://img.example/retry-a.png",
            "https://img.example/retry-b.png",
        ])

    def test_poll_workbench_run_stops_after_two_transient_retries(self):
        run_uid = "run-retry-limit"
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "status": "running",
            "summary": {
                "runs": [{
                    "run_uid": run_uid,
                    "prompt": "retry limit",
                    "requested_count": 1,
                    "model_key": "gpt-image-2",
                    "model_key_tier": "2k",
                    "size": "1024x1024",
                    "ratio": "1:1",
                    "quality": "high",
                    "response_format": "png",
                    "input_params": {"main_image_path": "", "reference_image_paths": []},
                    "status": "running",
                    "provider_status": "running",
                    "task_id": "task-original",
                    "poll_url": "https://api.example/images/tasks/task-original",
                    "poll_after": 5,
                    "retry_count": 0,
                    "retry_history": [],
                    "image_urls": [],
                    "output_files": [],
                }],
            },
        })
        client = FakeWorkbenchClient(
            create_responses=[
                {"id": "task-retry-1", "status": "queued", "poll_after": 5},
                {"id": "task-retry-2", "status": "queued", "poll_after": 5},
            ],
            poll_responses=[
                {"id": "task-original", "status": "failed", "message": "bad response status code 504"},
                {"id": "task-retry-1", "status": "failed", "message": "upstream timeout 503"},
                {"id": "task-retry-2", "status": "failed", "message": "gateway timeout 504"},
            ],
        )

        result = ai_image_service.poll_workbench_run(
            self.job["job_uid"],
            run_uid,
            client,
            sleep_fn=lambda _seconds: None,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(len(client.created_payloads), 2)
        run = data_sink.get_ai_image_job(self.job["job_uid"])["summary"]["runs"][0]
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["retry_count"], 2)
        self.assertEqual(len(run["retry_history"]), 2)
        self.assertIn("504", run["error"])

    def test_manual_retry_reuses_failed_run_snapshot_and_restarts_auto_retry_budget(self):
        run_uid = "run-manual-retry"
        retry_history = [
            {"retry_index": 1, "task_id": "task-original", "error": "504"},
            {"retry_index": 2, "task_id": "task-auto-retry-1", "error": "503"},
        ]
        data_sink.update_ai_image_job(self.job["job_uid"], {
            "params": {
                "size": "2448x3264",
                "ratio": "3:4",
                "quality": "low",
                "response_format": "webp",
                "n": 1,
                "model_key_tier": "4k",
            },
            "status": "failed",
            "summary": {
                "runs": [{
                    "run_uid": run_uid,
                    "prompt": "retry original settings",
                    "requested_count": 2,
                    "model_key": "gpt-image-2",
                    "model_key_tier": "2k",
                    "size": "1024x1024",
                    "ratio": "1:1",
                    "quality": "high",
                    "response_format": "png",
                    "input_params": {"main_image_path": "", "reference_image_paths": []},
                    "status": "failed",
                    "provider_status": "failed",
                    "task_id": "task-auto-retry-2",
                    "poll_url": "https://api.example/images/tasks/task-auto-retry-2",
                    "poll_after": 5,
                    "retry_count": 2,
                    "retry_history": retry_history,
                    "manual_retry_count": 0,
                    "image_urls": [],
                    "output_files": [],
                    "error": "gateway timeout 504",
                }],
            },
        })
        client = FakeWorkbenchClient(create_responses=[{
            "id": "task-manual-retry-1",
            "status": "queued",
            "poll_url": "https://api.example/images/tasks/task-manual-retry-1",
            "poll_after": 3,
        }])
        poll_submissions = []

        result = ai_image_service.retry_workbench_run(
            self.job["job_uid"],
            run_uid,
            settings=self._settings(),
            client_factory=lambda *_args, **_kwargs: client,
            poll_submitter=lambda fn, *args: poll_submissions.append((fn, args)),
        )

        self.assertTrue(result["accepted"])
        self.assertEqual(len(client.created_payloads), 1)
        retry_payload, retry_key = client.created_payloads[0]
        self.assertEqual(retry_payload["prompt"], "retry original settings")
        self.assertEqual(retry_payload["size"], "1024x1024")
        self.assertEqual(retry_payload["quality"], "high")
        self.assertEqual(retry_payload["output_format"], "png")
        self.assertEqual(retry_payload["n"], 2)
        self.assertTrue(retry_key.endswith("_manual_retry_1"))
        run = result["run"]
        self.assertEqual(run["status"], "queued")
        self.assertEqual(run["task_id"], "task-manual-retry-1")
        self.assertEqual(run["retry_count"], 0)
        self.assertEqual(run["manual_retry_count"], 1)
        self.assertEqual(run["retry_history"], retry_history)
        self.assertEqual(run["error"], "")
        self.assertEqual(len(poll_submissions), 1)
        self.assertIs(poll_submissions[0][0], ai_image_service.poll_workbench_run)


if __name__ == "__main__":
    unittest.main()
