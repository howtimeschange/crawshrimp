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


class ParamType(str, Enum):
    text       = "text"        # 单行文本输入
    radio      = "radio"       # 单选框组
    select     = "select"      # 下拉选择
    checkbox   = "checkbox"    # 复选框组（多选）
    date_range = "date_range"  # 日期区间（start_date / end_date）
    number     = "number"      # 数字输入


class ParamOption(BaseModel):
    value: str
    label: str


class TaskParam(BaseModel):
    id: str                            # 参数 key，注入到 window.__CRAWSHRIMP_PARAMS__
    type: ParamType
    label: str
    placeholder: Optional[str] = None
    hint: Optional[str] = None
    default: Optional[Any] = None
    options: Optional[List[ParamOption]] = None  # radio / select / checkbox 用
    required: bool = False
    min: Optional[float] = None        # number 用
    max: Optional[float] = None
    step: Optional[float] = None


class TaskDefinition(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    script: str
    params: List[TaskParam] = []       # 脚本声明的 UI 输入参数
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
