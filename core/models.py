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


class TaskOutputColumnGroup(BaseModel):
    label: str
    columns: List[str]


class TaskOutputSheet(BaseModel):
    name: str
    columns: Optional[List[str]] = None
    column_groups: Optional[List[TaskOutputColumnGroup]] = None


class TaskOutput(BaseModel):
    type: OutputType
    filename: Optional[str] = None
    channel: Optional[str] = None
    condition: Optional[str] = None
    columns: Optional[List[str]] = None  # excel 用：显式列顺序；未填则按 data 字段顺序导出
    column_groups: Optional[List[TaskOutputColumnGroup]] = None  # excel 用：两层表头分组定义
    sheet_key: Optional[str] = None  # excel 用：按行字段拆分多 sheet
    sheets: Optional[List[TaskOutputSheet]] = None  # excel 用：多 sheet 列定义


class TaskTrigger(BaseModel):
    type: TriggerType = TriggerType.manual
    interval_minutes: Optional[int] = None
    cron: Optional[str] = None


class ParamType(str, Enum):
    text       = "text"        # 单行文本输入
    radio      = "radio"       # 单选框组
    select     = "select"      # 下拉选择
    checkbox   = "checkbox"    # 复选框组（多选）
    week       = "week"        # 单周选择（YYYY-Www）
    month      = "month"       # 单月选择（YYYY-MM）
    date_range = "date_range"  # 日期区间（start_date / end_date）
    week_range = "week_range"  # 周区间（start_week / end_week）
    month_range = "month_range"  # 月区间（start_month / end_month）
    number     = "number"      # 数字输入
    file_excel = "file_excel"  # Excel 文件选择（.xlsx/.xls/.csv），注入 rows 数组
    file_images = "file_images"  # 多图文件选择（png/jpg/jpeg），注入 paths 数组


class ParamOption(BaseModel):
    value: str
    label: str


class TaskTemplate(BaseModel):
    file: str                            # 适配包内模板文件相对路径
    label: Optional[str] = None          # GUI 显示名
    description: Optional[str] = None    # 模板说明文案
    version: Optional[str] = None        # 模板版本
    path: Optional[str] = None           # 运行时解析出的模板绝对路径（由后端填充）


class TaskParam(BaseModel):
    id: str                            # 参数 key，注入到 window.__CRAWSHRIMP_PARAMS__
    type: ParamType
    label: str
    placeholder: Optional[str] = None
    hint: Optional[str] = None
    template_file: Optional[str] = None   # file_excel: 适配包内模板文件相对路径
    template_label: Optional[str] = None  # file_excel: GUI 下载模板按钮文案
    template_path: Optional[str] = None   # 运行时解析出的模板绝对路径（由后端填充）
    templates: Optional[List[TaskTemplate]] = None  # 多模板下载配置
    default: Optional[Any] = None
    options: Optional[List[ParamOption]] = None  # radio / select / checkbox 用
    visible_when: Optional[dict[str, Any]] = None  # GUI 可选：按其他字段值控制显示
    required: bool = False
    min: Optional[float] = None        # number 用
    max: Optional[float] = None
    step: Optional[float] = None


class TaskDefinition(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    script: str
    execution_ui_mode: Optional[str] = None  # 可选：precheck_before_live 等前端执行交互模式
    validation_only_label: Optional[str] = None  # 可选：仅校验按钮文案
    auto_precheck_note: Optional[str] = None  # 可选：执行按钮旁提示文案
    entry_url: Optional[str] = None   # 可选：覆盖 adapter 级入口，适用于同 adapter 下的不同站点
    tab_match_prefixes: Optional[List[str]] = None  # 可选：current 模式下用于匹配已有标签页的 URL 前缀
    skip_auth: bool = False           # 可选：跳过 adapter 级 auth_check
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
    tab_match_prefixes: Optional[List[str]] = None  # 可选：current 模式下用于匹配已有标签页的 URL 前缀
    auth: Optional[AdapterAuth] = None
    tasks: List[TaskDefinition] = []


class TaskStatus(str, Enum):
    idle = "idle"
    running = "running"
    paused = "paused"
    stopped = "stopped"
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
