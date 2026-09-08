"""Failure and concurrency regressions from the September repository review."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from core import adapter_loader, ai_image_service, api_server, browser_session, data_sink, scheduler
from core.models import AdapterManifest
from core.one_xm_image import RetryableOneXMImageError
from core.runtime_install_guard import RuntimeInstallGuard


@pytest.fixture
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path))
    monkeypatch.setenv('CRAWSHRIMP_ALLOW_DATA_FALLBACK', '0')
    monkeypatch.setattr('core.runtime_paths.data_root', lambda: tmp_path)
    data_sink.init_db()
    return tmp_path


class ImageClient:
    api_key = 'fake-secret'

    def __init__(self):
        self.created = []
        self.polls = []

    def create_task(self, payload, **kwargs):
        self.created.append(kwargs['idempotency_key'])
        return {'id': 'remote-task', 'status': 'queued', 'poll_url': 'https://example.invalid/task', 'poll_after': 1}

    def get_task(self, url):
        self.polls.append(url)
        return {'id': 'remote-task', 'status': 'succeeded', 'data': [{'url': 'https://example.invalid/result.png'}]}


def running_image_job():
    return data_sink.create_ai_image_job({'status': 'running', 'summary': {'runs': [{
        'run_uid': 'run', 'status': 'running', 'provider_status': 'running',
        'task_id': 'remote-task', 'poll_url': 'https://example.invalid/task', 'poll_after': 1,
    }]}})


def test_concurrent_same_image_request_creates_one_provider_task(isolated_store, monkeypatch):
    job = data_sink.create_ai_image_job({'title': 'concurrent'})
    client = ImageClient()
    barrier = threading.Barrier(2)
    build = ai_image_service.build_workbench_one_xm_payload

    def synchronized_payload(*args, **kwargs):
        # Force both requests past the initial deduplication check.
        payload = build(*args, **kwargs)
        barrier.wait(timeout=5)
        return payload

    monkeypatch.setattr(ai_image_service, 'build_workbench_one_xm_payload', synchronized_payload)
    def submit():
        return ai_image_service.submit_workbench_batch(
            job['job_uid'], ['one image'], request_uid='same-request', settings={'2k': 'fake-secret'},
            client_factory=lambda *a, **kw: client, poll_submitter=lambda *a: None,
        )
    with ThreadPoolExecutor(max_workers=2) as pool:
        requests = [pool.submit(submit) for _ in range(2)]
        results = [request.result(timeout=10) for request in requests]
    assert len(client.created) == 1
    assert results[0]['batch_uid'] == results[1]['batch_uid']
    assert sorted(result['deduplicated'] for result in results) == [False, True]
    assert len(data_sink.get_ai_image_job(job['job_uid'])['summary']['runs']) == 1


def test_image_poll_outage_preserves_handle_and_recovers_without_resubmission(isolated_store):
    job = running_image_job()
    client = ImageClient()
    get_task = client.get_task
    attempts = 0
    delays = []

    def flaky_get(url):
        nonlocal attempts
        attempts += 1
        if attempts <= 3:
            raise RetryableOneXMImageError('offline fake-secret')
        return get_task(url)

    client.get_task = flaky_get
    def sleep(delay):
        delays.append(delay)
        if attempts:
            run = data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][0]
            assert run['status'] == 'running'
            assert run['provider_status'] == 'running'
            assert run['task_id'] == 'remote-task'
            assert 'fake-secret' not in run['last_poll_error']

    result = ai_image_service.poll_workbench_run(job['job_uid'], 'run', client, sleep_fn=sleep)
    assert result['run']['status'] == 'completed'
    assert result['run']['last_poll_error'] == ''
    assert result['run']['poll_error_count'] == 0
    assert delays == [1, 5, 10, 20]
    assert client.created == []


def test_image_refresh_outage_can_query_original_task_after_recovery(isolated_store):
    job = running_image_job()
    client = ImageClient()
    get_task = client.get_task
    client.get_task = Mock(side_effect=RetryableOneXMImageError('temporary outage'))
    options = {'settings': {'2k': 'fake-secret'}, 'client_factory': lambda *a, **kw: client}
    updated = ai_image_service.refresh_workbench_run_once(job['job_uid'], 'run', **options)
    assert updated['summary']['runs'][0]['status'] == 'running'
    client.get_task = get_task
    updated = ai_image_service.refresh_workbench_run_once(job['job_uid'], 'run', **options)
    assert updated['summary']['runs'][0]['status'] == 'completed'
    assert client.created == []
    assert client.polls == ['https://example.invalid/task']


@pytest.fixture
def installer(isolated_store, monkeypatch):
    for name in ('_adapters', '_adapter_dirs', '_enabled', '_install_meta'):
        monkeypatch.setattr(adapter_loader, name, {})
    source = isolated_store / 'source'
    source.mkdir()
    (source / 'manifest.yaml').write_text('id: review-demo\nname: Review\nversion: 1.0.0\nentry_url: https://example.com\ntasks: []\n')
    (source / 'data.txt').write_text('old content')
    adapter_loader.install_from_dir(str(source))
    return source, isolated_store / 'adapters' / 'review-demo'


@pytest.mark.parametrize('failure', ['copy', 'validate', 'switch', 'metadata'])
def test_adapter_failed_update_restores_old_files_and_metadata(installer, monkeypatch, failure):
    source, destination = installer
    old_meta = adapter_loader.get_install_metadata('review-demo')
    meta_path = destination.parent.parent / 'adapter-meta' / 'review-demo.json'
    old_meta_bytes = meta_path.read_bytes()
    (source / 'data.txt').write_text('new content')
    manifest_path = source / 'manifest.yaml'
    manifest_path.write_text(manifest_path.read_text().replace('1.0.0', '2.0.0'))
    if failure == 'copy':
        monkeypatch.setattr(adapter_loader.shutil, 'copytree', Mock(side_effect=OSError('disk full')))
    elif failure == 'validate':
        read = adapter_loader._read_manifest_file
        def fail_staged(path):
            if path.parent.name == 'new':
                raise ValueError('invalid staged files')
            return read(path)
        monkeypatch.setattr(adapter_loader, '_read_manifest_file', fail_staged)
    elif failure == 'switch':
        rename = Path.rename
        def fail_switch(path, target):
            if path.name == 'new':
                raise OSError('switch failed')
            return rename(path, target)
        monkeypatch.setattr(Path, 'rename', fail_switch)
    else:
        monkeypatch.setattr(adapter_loader.os, 'replace', Mock(side_effect=OSError('metadata write failed')))
    with pytest.raises((OSError, ValueError)):
        adapter_loader.install_from_dir(str(source))
    assert (destination / 'data.txt').read_text() == 'old content'
    assert adapter_loader.get_adapter('review-demo').version == '1.0.0'
    assert adapter_loader.get_install_metadata('review-demo') == old_meta
    assert meta_path.read_bytes() == old_meta_bytes
    assert not list(destination.parent.parent.glob('.adapter-install-*'))


def test_adapter_self_install_is_rejected_before_deleting_source(installer):
    _, destination = installer
    with pytest.raises(ValueError):
        adapter_loader.install_from_dir(str(destination))
    assert (destination / 'data.txt').read_text() == 'old content'


@pytest.mark.parametrize('mode', ['copy', 'link'])
def test_adapter_successful_update_publishes_complete_new_version(installer, mode):
    source, destination = installer
    (source / 'data.txt').write_text('new content')
    adapter_loader.install_from_dir(str(source), install_mode=mode)
    assert (destination / 'data.txt').read_text() == 'new content'
    assert destination.is_symlink() == (mode == 'link')
    assert adapter_loader.get_install_metadata('review-demo')['runtime_path'] == str(destination.resolve())
    assert not list(destination.parent.parent.glob('.adapter-install-*'))


def test_adapter_link_to_copy_update_does_not_delete_link_source(installer):
    source, destination = installer
    adapter_loader.install_from_dir(str(source), install_mode='link')
    adapter_loader.install_from_dir(str(source), install_mode='copy')
    assert not destination.is_symlink()
    assert (source / 'data.txt').read_text() == 'old content'
    assert (destination / 'data.txt').read_text() == 'old content'


@pytest.mark.parametrize('replacement', ['manual', 'removed', 'required', 'cron_missing'])
def test_reinstall_removes_obsolete_manifest_schedule(monkeypatch, replacement):
    monkeypatch.setattr(scheduler, '_scheduler', AsyncIOScheduler())
    monkeypatch.setattr(scheduler, '_task_callbacks', {})
    base = {'id': 'review-demo', 'name': 'Review', 'entry_url': 'https://example.com'}
    old_task = {'id': 'task', 'name': 'Task', 'script': 'task.js', 'trigger': {'type': 'interval', 'interval_minutes': 5}}
    scheduler.register_adapter(AdapterManifest(**base, tasks=[old_task]), Mock())
    other = {**base, 'id': 'unrelated'}
    scheduler.register_adapter(AdapterManifest(**other, tasks=[old_task]), Mock())
    new_task = dict(old_task)
    if replacement == 'manual':
        new_task['trigger'] = {'type': 'manual'}
    if replacement == 'required':
        new_task['params'] = [{'id': 'file', 'type': 'text', 'label': 'File', 'required': True}]
    if replacement == 'cron_missing':
        new_task['trigger'] = {'type': 'cron'}
    scheduler.register_adapter(AdapterManifest(**base, tasks=[] if replacement == 'removed' else [new_task]), Mock())
    assert scheduler.get_scheduler().get_job('review-demo::task') is None
    assert scheduler.get_scheduler().get_job('unrelated::task') is not None
    if replacement == 'removed':
        assert 'review-demo::task' not in scheduler._task_callbacks


@pytest.mark.parametrize(('url', 'prefix', 'expected'), [
    ('https://agentseller.temu.com.evil.invalid', 'https://agentseller.temu.com', False),
    ('https://agentseller.temu.com@evil.invalid', 'https://agentseller.temu.com', False),
    ('http://agentseller.temu.com/main', 'https://agentseller.temu.com', False),
    ('https://agentseller.temu.com:444/main', 'https://agentseller.temu.com', False),
    ('https://agentseller.temu.com:443/main', 'https://agentseller.temu.com', True),
    ('https://AGENTSELLER.TEMU.COM/main?a=1', 'https://agentseller.temu.com', True),
    ('https://agentseller-us.temu.com/main?a=1', 'https://agentseller.temu.com/main', True),
    ('https://agentseller-us.temu.com.evil.invalid/main', 'https://agentseller.temu.com', False),
    ('https://agentseller-us.temu.com/other', 'https://agentseller.temu.com/main', False),
    ('https://example.com:invalid/', 'https://example.com', False),
    ('https://example.com/app?a=1#detail', 'https://example.com/app', True),
    ('', '', False),
])
def test_browser_and_task_page_selection_require_real_origin(url, prefix, expected):
    assert api_server._url_matches_prefix(url, prefix) is expected
    assert browser_session._url_matches_prefix(url, prefix) is expected


def test_restart_stops_current_instance_but_preserves_other_generations(isolated_store):
    instance = data_sink.create_task_instance('review-demo', 'task', 'Interrupted', {})
    run_id = data_sink.begin_run('review-demo', 'task')
    data_sink.link_task_instance_run(instance['instance_uid'], run_id)
    data_sink.update_task_instance(instance['instance_uid'], status='running', summary={'keep': 'value'})
    other = data_sink.create_task_instance('review-demo', 'task', 'Already finished', {})
    old_id = data_sink.begin_run('review-demo', 'task')
    data_sink.link_task_instance_run(other['instance_uid'], old_id)
    new_id = data_sink.begin_run('review-demo', 'task')
    data_sink.link_task_instance_run(other['instance_uid'], new_id)
    data_sink.finish_run(new_id, 1, [])
    data_sink.update_task_instance(other['instance_uid'], status='completed', summary={'keep': 'new generation'})
    before = data_sink.get_task_instance(other['instance_uid'])
    assert data_sink.stop_orphaned_active_runs('backend restarted') == 2
    after = data_sink.get_task_instance_detail(instance['instance_uid'])
    assert after['status'] == 'stopped'
    assert after['completed_at']
    assert after['summary']['keep'] == 'value'
    assert after['summary']['error'] == 'backend restarted'
    assert after['summary']['run_id'] == run_id
    assert data_sink.get_task_instance(other['instance_uid']) == before
    assert data_sink.stop_orphaned_active_runs() == 0


@pytest.mark.parametrize('persisted', [False, True])
def test_scheduled_task_supports_controls_and_waits_for_cancel_cleanup(isolated_store, monkeypatch, persisted):
    for name in ('_run_logs', '_run_status', '_run_controls', '_task_locks', '_task_run_queues'):
        monkeypatch.setattr(api_server, name, {})
    monkeypatch.setattr(api_server, 'runtime_install_guard', RuntimeInstallGuard())

    async def scenario():
        started = asyncio.Event()
        cleaning = asyncio.Event()
        finish_cleanup = asyncio.Event()
        params = {}
        if persisted:
            instance = data_sink.create_task_instance('review-demo', 'task', 'Scheduled')
            params = {'__task_instance_uid': instance['instance_uid']}
            monkeypatch.setattr(api_server, '_create_instance_for_task_schedule', lambda uid: {
                'adapter_id': 'review-demo', 'task_id': 'task', 'instance_uid': instance['instance_uid'], 'run_params': params,
            })
        jids = api_server._run_jids('review-demo', 'task', params.get('__task_instance_uid', ''))
        async def execute(adapter, task, supplied_params, options, run_control):
            assert run_control is not None
            api_server._set_live_status(jids, {'status': 'running'})
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaning.set()
                await finish_cleanup.wait()
                api_server._set_live_status(jids, {'status': 'stopped'})
        monkeypatch.setattr(api_server, '_execute_task', execute)
        scheduled = asyncio.create_task(api_server._run_task_schedule('schedule') if persisted else api_server._run_scheduled_task('review-demo', 'task'))
        try:
            await asyncio.wait_for(started.wait(), 2)
            assert not scheduled.done()
            assert not api_server.runtime_install_guard.readiness()['ready']
            control = api_server._run_controls[jids[0]]
            assert all(api_server._run_controls[jid] is control for jid in jids)
            assert api_server._pause_run_jid(jids[0])['status'] == 'pausing'
            assert control['pause_requested'] and not control['resume_event'].is_set()
            assert api_server._resume_run_jid(jids[0])['status'] == 'running'
            assert not control['pause_requested'] and control['resume_event'].is_set()
            assert api_server._stop_run_jid(jids[0])['status'] == 'stopping'
            await asyncio.wait_for(cleaning.wait(), 2)
            assert not scheduled.done()
            assert api_server._task_is_active('review-demo::task')
            finish_cleanup.set()
            await asyncio.wait_for(scheduled, 2)
            assert not api_server._run_controls
            assert api_server.runtime_install_guard.readiness()['ready']
        finally:
            finish_cleanup.set()
            if not scheduled.done():
                scheduled.cancel()
                await asyncio.gather(scheduled, return_exceptions=True)
    asyncio.run(scenario())


def test_restart_repairs_instances_left_running_by_older_cleanup(isolated_store):
    instance = data_sink.create_task_instance('review-demo', 'task', 'Old interrupted task')
    run_id = data_sink.begin_run('review-demo', 'task')
    data_sink.link_task_instance_run(instance['instance_uid'], run_id)
    data_sink.update_task_instance(instance['instance_uid'], status='running')
    data_sink.stop_run(run_id, 2, [], 'previous restart')
    finished_at = data_sink.get_latest_run('review-demo', 'task')['finished_at']
    assert data_sink.stop_orphaned_active_runs() == 0
    recovered = data_sink.get_task_instance_detail(instance['instance_uid'])
    assert recovered['status'] == 'stopped'
    assert recovered['completed_at'] == finished_at
    assert recovered['summary']['error'] == 'previous restart'


@pytest.mark.parametrize('outcome', ['raise', 'shutdown'])
def test_scheduled_failure_or_shutdown_releases_every_control(isolated_store, monkeypatch, outcome):
    for name in ('_run_logs', '_run_status', '_run_controls', '_task_locks', '_task_run_queues'):
        monkeypatch.setattr(api_server, name, {})
    monkeypatch.setattr(api_server, 'runtime_install_guard', RuntimeInstallGuard())
    instance = data_sink.create_task_instance('review-demo', 'task', 'Scheduled')
    uid = instance['instance_uid']
    params = {'__task_instance_uid': uid}
    monkeypatch.setattr(api_server, '_create_instance_for_task_schedule', lambda _: {
        'adapter_id': 'review-demo', 'task_id': 'task', 'instance_uid': uid, 'run_params': params,
    })

    async def scenario():
        started = asyncio.Event()
        child_finished = asyncio.Event()
        jids = api_server._run_jids('review-demo', 'task', uid)
        async def execute(*args, **kwargs):
            api_server._set_live_status(jids, {'status': 'running'})
            started.set()
            if outcome == 'raise':
                raise RuntimeError('failed before begin_run')
            try:
                await asyncio.Event().wait()
            finally:
                api_server._set_live_status(jids, {'status': 'stopped'})
                child_finished.set()
        monkeypatch.setattr(api_server, '_execute_task', execute)
        scheduled = asyncio.create_task(api_server._run_task_schedule('schedule'))
        await asyncio.wait_for(started.wait(), 2)
        if outcome == 'shutdown':
            scheduled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await scheduled
            assert child_finished.is_set()
        else:
            await scheduled
            assert data_sink.get_task_instance(uid)['status'] == 'failed'
        assert not api_server._run_controls
        assert not api_server._task_is_active('review-demo::task')
        assert api_server.runtime_install_guard.readiness()['ready']
    asyncio.run(scenario())


@pytest.mark.parametrize('tab_url', [
    'http://agentseller.temu.com/main',
    'https://agentseller.temu.com:444/main',
    'https://agentseller.temu.com:0/main',
    'https://agentseller.temu.com@evil.invalid/main',
    'https://agentseller.temu.com.evil.invalid/main',
])
def test_temu_compatibility_fallback_cannot_bypass_origin_checks(tab_url):
    assert not api_server._url_matches_prefix(tab_url, 'https://agentseller.temu.com')
    assert not api_server._is_compatible_current_tab_for_task(
        'temu', 'task', 'https://agentseller.temu.com/main', tab_url,
    )


def test_temu_compatibility_allows_registered_regional_origins():
    assert api_server._is_compatible_current_tab_for_task(
        'temu', 'task', 'https://agentseller-us.temu.com/main', 'https://agentseller-eu.temu.com/other',
    )
