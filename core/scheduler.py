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
import inspect
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from core.models import AdapterManifest, TriggerType

logger = logging.getLogger(__name__)
APP_TIMEZONE = timezone(timedelta(hours=8), "UTC+08:00")

# job_id format: "{adapter_id}::{task_id}"
_scheduler: Optional[AsyncIOScheduler] = None
_task_callbacks: Dict[str, Callable] = {}  # job_id -> async callable
_begin_runtime_operation: Callable[[str, str, str, str], str] | None = None
_end_runtime_operation: Callable[[str], None] | None = None
WEEKDAY_NAMES = {
    1: "mon",
    2: "tue",
    3: "wed",
    4: "thu",
    5: "fri",
    6: "sat",
    7: "sun",
}


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        # Windows Python builds do not always ship an IANA timezone database.
        # Crawshrimp only needs China standard time, so use a fixed UTC+8 tzinfo.
        _scheduler = AsyncIOScheduler(timezone=APP_TIMEZONE)
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


def schedule_job_id(schedule_uid: str) -> str:
    return f"schedule::{str(schedule_uid or '').strip()}"


def set_runtime_operation_hooks(begin_operation=None, end_operation=None) -> None:
    global _begin_runtime_operation, _end_runtime_operation
    _begin_runtime_operation = begin_operation
    _end_runtime_operation = end_operation


def _begin_scheduled_runtime_operation(kind: str, operation_id: str, label: str) -> str:
    if _begin_runtime_operation is None:
        return ""
    return str(_begin_runtime_operation(kind, operation_id, label, "running") or "")


def _end_scheduled_runtime_operation(token: str) -> None:
    if token and _end_runtime_operation is not None:
        _end_runtime_operation(token)


def _parse_time_of_day(value: str) -> tuple[int, int]:
    text = str(value or "").strip()
    parts = text.split(":")
    if len(parts) != 2:
        raise ValueError("time_of_day must use HH:MM")
    hour = int(parts[0])
    minute = int(parts[1])
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise ValueError("time_of_day must be a valid HH:MM value")
    return hour, minute


def _task_schedule_trigger(schedule: dict) -> CronTrigger:
    frequency = str((schedule or {}).get("frequency") or "").strip().lower()
    hour, minute = _parse_time_of_day(str((schedule or {}).get("time_of_day") or ""))
    if frequency == "daily":
        return CronTrigger(hour=hour, minute=minute, timezone=APP_TIMEZONE)
    if frequency == "weekly":
        weekday = int((schedule or {}).get("weekday") or 0)
        day_name = WEEKDAY_NAMES.get(weekday)
        if not day_name:
            raise ValueError("weekday must be 1..7 for weekly schedules")
        return CronTrigger(day_of_week=day_name, hour=hour, minute=minute, timezone=APP_TIMEZONE)
    raise ValueError("frequency must be daily or weekly")


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
            token = _begin_scheduled_runtime_operation("scheduled_task", job_id(a, t), f"{a}::{t}")
            if _begin_runtime_operation is not None and not token:
                return
            try:
                await run_callback(a, t)
            except Exception as e:
                logger.error(f"Scheduled job {a}::{t} failed: {e}")
            finally:
                _end_scheduled_runtime_operation(token)

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


def register_task_schedule(schedule: dict, run_callback: Callable) -> int:
    """
    Register one persisted task schedule.
    run_callback: async fn(schedule_uid) -> None
    Returns 1 when a job is registered, otherwise 0.
    """
    schedule_uid = str((schedule or {}).get("schedule_uid") or "").strip()
    if not schedule_uid:
        raise ValueError("schedule_uid is required")
    jid = schedule_job_id(schedule_uid)
    sched = get_scheduler()

    if sched.get_job(jid):
        sched.remove_job(jid)

    _task_callbacks[jid] = run_callback
    if int((schedule or {}).get("enabled") or 0) != 1 or int((schedule or {}).get("archived") or 0) == 1:
        logger.info("Task schedule %s is disabled or archived; callback registered without APScheduler job", schedule_uid)
        return 0

    trigger = _task_schedule_trigger(schedule)

    async def _job(uid=schedule_uid):
        token = _begin_scheduled_runtime_operation("task_schedule", jid, f"schedule::{uid}")
        if _begin_runtime_operation is not None and not token:
            return
        try:
            result = run_callback(uid)
            if inspect.isawaitable(result):
                await result
        except Exception as e:
            logger.error("Scheduled task schedule %s failed: %s", uid, e)
        finally:
            _end_scheduled_runtime_operation(token)

    sched.add_job(_job, trigger=trigger, id=jid, replace_existing=True)
    logger.info("Registered task schedule job %s", jid)
    return 1


def register_task_schedules(schedules: list[dict], run_callback: Callable) -> int:
    count = 0
    for schedule in schedules or []:
        count += register_task_schedule(schedule, run_callback)
    return count


def unregister_task_schedule(schedule_uid: str) -> int:
    """Remove one persisted schedule job and callback."""
    jid = schedule_job_id(schedule_uid)
    sched = get_scheduler()
    removed = 0
    if sched.get_job(jid):
        sched.remove_job(jid)
        removed = 1
    _task_callbacks.pop(jid, None)
    return removed


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
        next_run = getattr(job, "next_run_time", None)
        if job.id.startswith("schedule::"):
            result.append({
                "job_id": job.id,
                "kind": "task_schedule",
                "schedule_uid": job.id.split("::", 1)[1],
                "adapter_id": "",
                "task_id": "",
                "next_run": next_run.isoformat() if next_run else None,
            })
        else:
            parts = job.id.split("::", 1)
            result.append({
                "job_id": job.id,
                "kind": "manifest_task",
                "adapter_id": parts[0] if len(parts) == 2 else "",
                "task_id": parts[1] if len(parts) == 2 else "",
                "schedule_uid": "",
                "next_run": next_run.isoformat() if next_run else None,
            })
    return result
