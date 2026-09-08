"""Regression tests for guarded execution and durable image recovery.

Only temporary SQLite/files and fake providers are used. No network writes.
"""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest

from core import ai_image_service as image, api_server, data_sink
from core.js_runner import JSRunner
from core.models import JSResult
from core.one_xm_image import RetryableOneXMImageError
from core.cloud_job_executors import CloudJobExecutor, CloudJobCancelled


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path))
    monkeypatch.setenv('CRAWSHRIMP_ALLOW_DATA_FALLBACK', '0')
    monkeypatch.setattr('core.runtime_paths.data_root', lambda: tmp_path)
    monkeypatch.setattr(image, '_WORKBENCH_STOP', threading.Event())
    data_sink.init_db()
    return tmp_path


def active_job():
    return data_sink.create_ai_image_job({'status': 'running', 'summary': {'runs': [{
        'run_uid': 'run', 'status': 'running', 'provider_status': 'running',
        'task_id': 'remote', 'poll_url': '/images/tasks/remote', 'poll_after': 1,
    }]}})


def options(client):
    return {'settings': {'2k': 'fake-review-key'}, 'client_factory': lambda *a, **kw: client}


@pytest.mark.parametrize('marker', ['Execution context was destroyed', 'Inspected target navigated or closed',
                                  'Promise was collected', 'Cannot find context with specified id'])
@pytest.mark.parametrize('readonly', [False, True])
def test_navigation_replay_requires_readonly_contract(isolated, marker, readonly):
    class Runner(JSRunner):
        def __init__(self):
            super().__init__('ws://example.invalid')
            self.posts = 0
        async def _persist_run_params(self, *args): pass
        async def _clear_run_params(self, *args): pass
        async def _refresh_ws_url(self): pass
        async def evaluate(self, *args, **kwargs):
            self.posts += 1
            if self.posts == 1:
                return JSResult(success=False, error=marker)
            return JSResult(success=True, data=[{'id': 'published'}], meta={'has_more': False})
    script = isolated / 'write.js'
    script.write_text('/* simulated platform write */')
    runner = Runner()
    if readonly:
        rows = asyncio.run(runner.run_script_file(script, retry_transient_cdp_errors=True))
    else:
        with pytest.raises(RuntimeError, match=marker):
            asyncio.run(runner.run_script_file(script, retry_transient_cdp_errors=False))
        rows = []
    print({'probe': 'write_navigation_replay', 'platform_posts': runner.posts, 'rows': rows})
    assert runner.posts == (2 if readonly else 1)


def test_stale_refresh_preserves_completed_run(isolated):
    job = active_job()
    query_started = threading.Event()
    release_stale_response = threading.Event()
    class Client:
        api_key = 'fake-review-key'
        def get_task(self, url):
            query_started.set()
            assert release_stale_response.wait(5)
            return {'id': 'remote', 'status': 'running'}
    client = Client()
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(image.refresh_workbench_run_once, job['job_uid'], 'run', **options(client))
        assert query_started.wait(5)
        class CompletedClient:
            api_key = 'fake-review-key'
            def get_task(self, url):
                return {'id': 'remote', 'status': 'succeeded', 'data': [{'url': 'https://example.invalid/result.png'}]}
        done = image.poll_workbench_run(job['job_uid'], 'run', CompletedClient(), sleep_fn=lambda _: None)
        assert done['run']['status'] == 'completed'
        release_stale_response.set()
        stale = future.result(5)
    run = stale['summary']['runs'][0]
    print({'probe': 'stale_refresh', 'before': 'completed', 'after': run['status'], 'job_status': stale['status']})
    assert run['status'] == stale['status'] == 'completed'


def test_unknown_image_submission_blocks_new_charge_key(isolated):
    job = data_sink.create_ai_image_job({'title': 'review unknown submission'})
    class Client:
        api_key = 'fake-review-key'
        def __init__(self): self.accepted = {}
        def create_task(self, payload, **kwargs):
            key = kwargs['idempotency_key']
            self.accepted.setdefault(key, 'remote-' + str(len(self.accepted) + 1))
            if len(self.accepted) == 1:
                raise RetryableOneXMImageError('response lost after accepted request; retries exhausted')
            return {'id': self.accepted[key], 'status': 'queued'}
    client = Client()
    result = image.submit_workbench_batch(job['job_uid'], ['draw'], request_uid='review-request',
        poll_submitter=lambda *a: None, **options(client))
    run = result['runs'][0]
    assert run['status'] == 'failed'
    assert run['error_code'] == 'UNKNOWN_SUBMIT_RESULT'
    assert run['idempotency_key'] in client.accepted
    with pytest.raises(ValueError, match='回执未知'):
        image.retry_workbench_run(job['job_uid'], run['run_uid'], poll_submitter=lambda *a: None, **options(client))
    print({'probe': 'unknown_submission_retry', 'remote_tasks': len(client.accepted), 'keys': list(client.accepted)})
    assert len(client.accepted) == 1


def test_reopened_image_job_resumes_original_provider_handle(isolated):
    job = active_job()
    class Client:
        api_key = 'fake-review-key'
        def __init__(self): self.queries = []
        def get_task(self, url):
            self.queries.append(url)
            return {'id': 'remote', 'status': 'succeeded', 'data': [{'url': 'https://example.invalid/done.png'}]}
        def create_task(self, *a, **kw): pytest.fail('Recovery must never create a provider task')
    client = Client()
    def submit(fn, *args):
        return fn(*args, sleep_fn=lambda _: None)
    image.recover_workbench_runs(poll_submitter=submit, **options(client))
    assert client.queries == ['/images/tasks/remote']
    assert api_server.get_ai_image_job(job['job_uid'])['status'] == 'completed'


@pytest.mark.parametrize('lease_lost', [False, True])
def test_cloud_cancel_during_operation_prevents_later_write(isolated, lease_lost):
    from core.cloud_approval_client import CloudApprovalError
    cancellation_seen = threading.Event()
    posted = []
    class Client:
        def request_json(self, method, path, body):
            cancellation_seen.set()
            if lease_lost:
                raise CloudApprovalError('stale lease')
            return {'cancel_requested': True}
    executor = CloudJobExecutor(Client(), work_dir=isolated, lease_renew_interval=0.001)
    def operation():
        assert cancellation_seen.wait(5)
        runner = JSRunner('ws://example.invalid')
        async def write(*a, **kw):
            posted.append('platform-write-after-cancel')
            return {'result': {'result': {'value': {'success': True}}}}
        runner._evaluate_raw = write
        asyncio.run(runner.evaluate('simulated platform write'))
        return {'status': 'succeeded'}
    with pytest.raises(CloudApprovalError if lease_lost else CloudJobCancelled):
        executor._run_with_lease_keeper({'job_uid': 'review', 'lease_id': 'lease'}, operation)
    print({'probe': 'cloud_cancel', 'writes_after_cancel_received': len(posted)})
    assert len(posted) == 0
    from core.execution_checkpoint import check_execution, has_execution_checkpoint
    assert not has_execution_checkpoint()
    check_execution()


def test_old_attempt_response_cannot_replace_retry_handle(isolated):
    job = active_job()
    uid = job['job_uid']
    old = job['summary']['runs'][0]
    image._update_workbench_run(uid, 'run', {'generation': 1, 'task_id': 'new', 'poll_url': '/new'})
    updated = image._update_workbench_run(uid, 'run', {
        'status': 'completed', 'task_id': 'remote', 'image_urls': ['stale.png']}, expected_run=old)
    current = updated['summary']['runs'][0]
    assert current['status'] == 'running'
    assert current['task_id'] == 'new'
    assert not current.get('image_urls')


def test_concurrent_manual_retries_reserve_one_attempt(isolated, monkeypatch):
    job = active_job()
    uid = job['job_uid']
    image._update_workbench_run(uid, 'run', {'status': 'failed'})
    barrier = threading.Barrier(2)
    monkeypatch.setattr(image, '_workbench_retry_payload', lambda *a: barrier.wait(5) and {'prompt': 'draw'})
    class Client:
        api_key = 'fake-review-key'
        def __init__(self): self.created = []
        def create_task(self, payload, **kw):
            self.created.append(kw['idempotency_key'])
            return {'id': 'new', 'status': 'queued'}
    client = Client()
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(image.retry_workbench_run, uid, 'run', poll_submitter=lambda *a: None,
                               **options(client)) for _ in range(2)]
        for future in futures: future.result(10)
    assert len(client.created) == 1
    run = data_sink.get_ai_image_job(uid)['summary']['runs'][0]
    assert run['manual_retry_count'] == 1
    assert run['task_id'] == 'new'


def test_recovery_does_not_steal_live_submission(isolated):
    started, release = threading.Event(), threading.Event()
    job = data_sink.create_ai_image_job({'title': 'live'})
    class Client:
        api_key = 'fake-review-key'
        def create_task(self, *a, **kw):
            started.set()
            assert release.wait(5)
            return {'id': 'accepted', 'status': 'queued'}
    client = Client()
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(image.submit_workbench_batch, job['job_uid'], ['draw'],
                             poll_submitter=lambda *a: None, **options(client))
        assert started.wait(5)
        image.recover_workbench_runs(poll_submitter=lambda *a: pytest.fail('Still submitting'), **options(client))
        run = data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][0]
        assert run['provider_status'] == 'submitting'
        release.set()
        assert future.result(5)['runs'][0]['task_id'] == 'accepted'


def test_orphan_submission_becomes_unknown_without_resubmission(isolated):
    job = active_job()
    image._update_workbench_run(job['job_uid'], 'run', {'task_id': '', 'poll_url': '', 'idempotency_key': 'original'})
    image.recover_workbench_runs(settings={}, poll_submitter=lambda *a: pytest.fail('Missing handle'))
    run = data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][0]
    assert run['error_code'] == 'UNKNOWN_SUBMIT_RESULT'
    assert run['idempotency_key'] == 'original'


def test_poll_registration_is_deduplicated_and_released(isolated, monkeypatch):
    from concurrent.futures import Future
    submitted = []
    monkeypatch.setattr(image, '_WORKBENCH_STOP', threading.Event())
    def submit(*a, **kw):
        future = Future()
        submitted.append(future)
        return future
    monkeypatch.setattr(image._WORKBENCH_POLL_EXECUTOR, 'submit', submit)
    assert image._schedule_workbench_poll('dedup', 'run', object())
    assert not image._schedule_workbench_poll('dedup', 'run', object())
    submitted[0].set_result(None)
    assert image._schedule_workbench_poll('dedup', 'run', object())
    submitted[1].set_result(None)
    assert ('dedup', 'run') not in image._WORKBENCH_POLLERS


def test_recovery_includes_jobs_older_than_ui_limit(isolated):
    first = active_job()
    for i in range(501):
        data_sink.create_ai_image_job({'title': f'recent-{i}'})
    assert first['job_uid'] not in {job['job_uid'] for job in data_sink.list_ai_image_jobs(limit=500)}
    assert first['job_uid'] in {job['job_uid'] for job in data_sink.list_active_ai_image_jobs()}


def test_stop_interrupts_poll_delay_without_changing_provider_state(isolated):
    job = active_job()
    stop = threading.Event()
    stop.set()
    result = image.poll_workbench_run(job['job_uid'], 'run', object(), stop_event=stop)
    assert result['stopped']
    assert data_sink.get_ai_image_job(job['job_uid'])['status'] == 'running'


def test_explicit_rejection_can_retry_but_automatic_retry_outage_cannot(isolated):
    from core.one_xm_image import RejectedOneXMImageError
    job = data_sink.create_ai_image_job({'title': 'reject'})
    class Client:
        api_key = 'fake-review-key'
        def __init__(self): self.creates = 0
        def create_task(self, *a, **kw):
            self.creates += 1
            if self.creates == 1: raise RejectedOneXMImageError('invalid request')
            if self.creates == 2: return {'id': 'remote', 'status': 'queued'}
            raise RetryableOneXMImageError('response lost')
        def get_task(self, url): return {'id': 'remote', 'status': 'failed', 'error': {'message': 'HTTP 504'}}
    client = Client()
    result = image.submit_workbench_batch(job['job_uid'], ['draw'], poll_submitter=lambda *a: None, **options(client))
    run = result['runs'][0]
    assert run['status'] == 'failed' and not run['error_code']
    image.retry_workbench_run(job['job_uid'], run['run_uid'], poll_submitter=lambda *a: None, **options(client))
    result = image.poll_workbench_run(job['job_uid'], run['run_uid'], client, sleep_fn=lambda _: None)
    assert result['run']['error_code'] == 'UNKNOWN_SUBMIT_RESULT'
    with pytest.raises(ValueError, match='回执未知'):
        image.retry_workbench_run(job['job_uid'], run['run_uid'], **options(client))
    assert client.creates == 3


def test_fresh_process_recovers_saved_task_without_new_post(isolated):
    import json
    import os
    import subprocess
    import sys
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def respond(self, body):
            encoded = json.dumps(body).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length', 0)))
            calls.append(('POST', self.path, self.headers.get('Idempotency-Key')))
            self.respond({'id': 'persisted-task', 'status': 'queued', 'poll_after': .01})
        def do_GET(self):
            calls.append(('GET', self.path))
            self.respond({'id': 'persisted-task', 'status': 'succeeded',
                          'data': [{'url': 'https://example.invalid/final.png'}]})
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings = {'2k': 'fake-review-key', 'base_url': f'http://127.0.0.1:{server.server_port}'}
    env = {**os.environ, 'CRAWSHRIMP_DATA': str(isolated), 'CRAWSHRIMP_ALLOW_DATA_FALLBACK': '0'}
    preamble = f"from core import data_sink, ai_image_service as image\ndata_sink.init_db()\nsettings = {settings!r}\n"
    create = preamble + '''job = data_sink.create_ai_image_job({'title': 'restart'})
result = image.submit_workbench_batch(job['job_uid'], ['draw'], settings=settings, poll_submitter=lambda *a: None)
assert result['runs'][0]['task_id'] == 'persisted-task'
print(job['job_uid'])
'''
    try:
        first = subprocess.run([sys.executable, '-c', create], env=env, capture_output=True, text=True, timeout=10, check=True)
        uid = first.stdout.strip()
        recover = preamble + f'''import time
from core import api_server
api_server._resolve_one_xm_settings = lambda: settings
image.ensure_workbench_worker_started()
try:
    for _ in range(100):
        job = data_sink.get_ai_image_job({uid!r})
        if job['status'] == 'completed': break
        time.sleep(.05)
    assert job['status'] == 'completed', job
    assert job['summary']['runs'][0]['task_id'] == 'persisted-task'
finally:
    image.stop_workbench_worker()
'''
        subprocess.run([sys.executable, '-c', recover], env=env, capture_output=True, text=True, timeout=10, check=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
    assert len([call for call in calls if call[0] == 'POST']) == 1
    assert [call[1] for call in calls if call[0] == 'GET'] == ['/images/tasks/persisted-task']


@pytest.mark.parametrize('target', ['task', '/images/tasks/task', 'https://example.invalid/v1/images/tasks/task'])
def test_poll_client_accepts_id_relative_and_absolute_routes(target):
    from core.one_xm_image import OneXMImageClient
    urls = []
    def transport(method, url, **kwargs):
        urls.append(url)
        return 200, {'status': 'succeeded'}
    client = OneXMImageClient('fake', base_url='https://example.invalid/v1', transport=transport)
    client.get_task(target)
    assert urls == ['https://example.invalid/v1/images/tasks/task']
