"""Pydantic 数据模型"""
from typing import Any, Optional, List
from pydantic import BaseModel
from enum import Enum


class TriggerType(str, Enum):
    manual = "manual"
    interval = "interval"
    cron = "cron"


class OutputType(str, Enum):
    excel = "excel"
    json = "json"
    sqlite = "sqlite"
    notify = "notify"


class TaskOutput(BaseModel):
    type: OutputType
    filename: Optional[str] = None
    channel: Optional[str] = None
    condition: Optional[str] = None


class TaskTrigger(BaseModel):
    type: TriggerType = TriggerType.manual
    interval_minutes: Optional[int] = None
    cron: Optional[str] = None


class TaskDefinition(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    script: str
    trigger: TaskTrigger = TaskTrigger()
    output: List[TaskOutput] = []


class AdapterAuth(BaseModel):
    check_script: Optional[str] = None
    login_url: Optional[str] = None


class AdapterManifest(BaseModel):
    id: str
    name: str
    version: str = "1.0.0"
    icon: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None
    entry_url: str
    auth: Optional[AdapterAuth] = None
    tasks: List[TaskDefinition] = []


class TaskStatus(str, Enum):
    idle = "idle"
    running = "running"
    done = "done"
    error = "error"


class TaskRun(BaseModel):
    adapter_id: str
    task_id: str
    status: TaskStatus = TaskStatus.idle
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    records_count: Optional[int] = None
    error: Optional[str] = None
    output_files: List[str] = []


class JSResult(BaseModel):
    success: bool
    data: Optional[List[Any]] = None
    meta: Optional[dict] = None
    error: Optional[str] = None
