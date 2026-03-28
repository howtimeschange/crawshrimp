"""
APScheduler task scheduling engine
Supports three trigger types: manual / interval / cron

Design:
- Adapters declare triggers in manifest.yaml
- Scheduler reads loaded adapters and registers jobs on startup
- Manual tasks are triggered on-demand via API
- State (last run, next run, status) persisted to SQLite via data_sink
"""
import asyncio
import logging
from datetime import datetime
from typing import Callable, Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from core.models import AdapterManifest, TriggerType

logger = logging.getLogger(__name__)

# job_id format: "{adapter_id}::{task_id}"
_scheduler: Optional[AsyncIOScheduler] = None
_task_callbacks: Dict[str, Callable] = {}  # job_id -> async callable


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")
    return _scheduler


def start():
    sched = get_scheduler()
    if not sched.running:
        sched.start()
        logger.info("Scheduler started")


def shutdown():
    sched = get_scheduler()
    if sched.running:
        sched.shutdown(wait=False)
        logger.info("Scheduler stopped")


def job_id(adapter_id: str, task_id: str) -> str:
    return f"{adapter_id}::{task_id}"


def register_adapter(manifest: AdapterManifest, run_callback: Callable) -> int:
    """
    Register all scheduled tasks for an adapter.
    run_callback: async fn(adapter_id, task_id) -> None
    Returns number of jobs registered.
    """
    sched = get_scheduler()
    count = 0
    for task in manifest.tasks:
        jid = job_id(manifest.id, task.id)
        trigger = task.trigger

        if trigger.type == TriggerType.manual:
            # Manual tasks are not auto-scheduled; triggered on-demand via API
            _task_callbacks[jid] = run_callback
            continue

        missing_required = [p.id for p in task.params if p.required and p.default is None]
        if missing_required:
            logger.warning(
                f"Task {jid} 需要运行参数 {missing_required}，当前调度器无持久化参数来源，跳过自动注册"
            )
            _task_callbacks[jid] = run_callback
            continue

        if trigger.type == TriggerType.interval:
            minutes = trigger.interval_minutes or 30
            apc_trigger = IntervalTrigger(minutes=minutes)
        elif trigger.type == TriggerType.cron:
            if not trigger.cron:
                logger.warning(f"Task {jid} has cron trigger but no cron expression, skipping")
                continue
            apc_trigger = CronTrigger.from_crontab(trigger.cron)
        else:
            continue

        # Wrap async callback
        async def _job(a=manifest.id, t=task.id):
            try:
                await run_callback(a, t)
            except Exception as e:
                logger.error(f"Scheduled job {a}::{t} failed: {e}")

        if sched.get_job(jid):
            sched.remove_job(jid)

        sched.add_job(_job, trigger=apc_trigger, id=jid, replace_existing=True)
        _task_callbacks[jid] = run_callback
        count += 1
        logger.info(f"Registered job {jid} ({trigger.type.value})")

    return count


def unregister_adapter(adapter_id: str):
    """Remove all scheduled jobs for an adapter"""
    sched = get_scheduler()
    removed = 0
    for job in sched.get_jobs():
        if job.id.startswith(f"{adapter_id}::"):
            sched.remove_job(job.id)
            removed += 1
    # Clear callbacks
    for jid in list(_task_callbacks.keys()):
        if jid.startswith(f"{adapter_id}::"):
            del _task_callbacks[jid]
    logger.info(f"Unregistered {removed} jobs for adapter {adapter_id}")


async def trigger_now(adapter_id: str, task_id: str):
    """Immediately execute a task (manual trigger)"""
    jid = job_id(adapter_id, task_id)
    cb = _task_callbacks.get(jid)
    if cb is None:
        raise ValueError(f"No callback registered for {jid}")
    await cb(adapter_id, task_id)


def list_jobs() -> list:
    """List all scheduled jobs with next run time"""
    sched = get_scheduler()
    result = []
    for job in sched.get_jobs():
        parts = job.id.split("::", 1)
        result.append({
            "job_id": job.id,
            "adapter_id": parts[0] if len(parts) == 2 else "",
            "task_id": parts[1] if len(parts) == 2 else "",
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return result
