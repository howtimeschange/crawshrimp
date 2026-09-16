"""OpenAI SSE transport with a deadline based on meaningful output activity."""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path


class _ThinkingTextFilter:
    """Some gateways send a leading think block through delta.content."""
    def __init__(self):
        self.mode = 'prefix'
        self.buffer = ''

    def feed(self, text):
        if self.mode == 'answer':
            return text, 0
        self.buffer += text
        if self.mode == 'prefix':
            stripped = self.buffer.lstrip()
            if '<think>'.startswith(stripped):
                if stripped != '<think>':
                    return '', 0
            elif not stripped.startswith('<think>'):
                self.mode = 'answer'
                answer, self.buffer = self.buffer, ''
                return answer, 0
            self.buffer = stripped[len('<think>'):]
            self.mode = 'thinking'
        end = self.buffer.find('</think>')
        if end >= 0:
            thought_chars = end
            answer = self.buffer[end+len('</think>'):]
            self.buffer = ''
            self.mode = 'answer'
            return answer, thought_chars
        # Retain only a possible split closing tag, never a full thought body.
        keep = len('</think>')-1
        count = max(0, len(self.buffer)-keep)
        self.buffer = self.buffer[count:]
        return '', count


def post_json_stream(url, payload, headers, *, idle_timeout=90, progress=None, include_usage=False):
    # Imported lazily to avoid a gateway/transport import cycle.
    from core.llm_gateway import LlmGatewayError

    curl = shutil.which('curl')
    if not curl:
        raise LlmGatewayError('流式模型请求需要 curl')
    idle_timeout = max(float(idle_timeout), .001)
    with tempfile.TemporaryDirectory(prefix='crawshrimp-llm-stream-') as temp:
        root = Path(temp)
        body, auth, errors, response_headers = (root / name for name in ('body.json', 'headers', 'errors', 'response-headers'))
        request_payload = {**payload, 'stream': True}
        if include_usage:
            request_payload['stream_options'] = {'include_usage': True}
        body.write_text(json.dumps(request_payload, ensure_ascii=False), encoding='utf-8')
        auth.write_text('\n'.join(f'{k}: {v}' for k, v in {'Content-Type': 'application/json', **headers}.items())+'\n', encoding='utf-8')
        for path in (body, auth):
            os.chmod(path, 0o600)
        messages = queue.Queue()
        started = last_activity = time.monotonic()
        last_notice = started
        content = []
        reasoning_chars = content_chars = events = 0
        first_activity = None
        finished = False
        usage = None
        usage_deadline = None
        returned_model = payload.get('model')
        text_filter = _ThinkingTextFilter()
        with errors.open('wb') as stderr:
            process = subprocess.Popen([
                curl, '--silent', '--show-error', '--no-buffer',
                '--connect-timeout', str(min(15, idle_timeout)),
                '--dump-header', str(response_headers),
                '--header', '@'+str(auth), '--data-binary', '@'+str(body), url,
            ], stdout=subprocess.PIPE, stderr=stderr,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            def reader():
                try:
                    for line in process.stdout:
                        messages.put(line)
                finally:
                    messages.put(None)
            worker = threading.Thread(target=reader, daemon=True)
            worker.start()
            http_checked = False
            try:
                while True:
                    if usage_deadline is not None and time.monotonic() >= usage_deadline:
                        break
                    remaining = idle_timeout - (time.monotonic()-last_activity)
                    if remaining <= 0:
                        if finished:
                            break
                        raise LlmGatewayError(f'流式模型超时：连续{idle_timeout:g}秒没有有效思考或答案片段')
                    try:
                        line = messages.get(timeout=min(remaining, 1))
                    except queue.Empty:
                        continue
                    if not http_checked:
                        statuses = re.findall(r'^HTTP/\S+\s+(\d{3})',
                            response_headers.read_text(errors='replace') if response_headers.exists() else '', re.MULTILINE)
                        if statuses and int(statuses[-1]) >= 400:
                            raise LlmGatewayError('流式模型接口返回 HTTP '+statuses[-1])
                        http_checked = bool(statuses)
                    if line is None:
                        break
                    line = line.decode('utf-8', errors='replace').strip()
                    if not line.startswith('data:'):
                        continue
                    raw = line[5:].strip()
                    if raw == '[DONE]':
                        finished = True
                        break
                    try:
                        event = json.loads(raw)
                    except ValueError as exc:
                        raise LlmGatewayError('流式模型返回无效事件 JSON') from exc
                    if not isinstance(event, dict) or event.get('error'):
                        raise LlmGatewayError('流式模型返回错误事件')
                    events += 1
                    returned_model = event.get('model') or returned_model
                    if isinstance(event.get('usage'), dict):
                        # Only retain numeric accounting metadata, never provider text.
                        usage = {k: v for k, v in event['usage'].items()
                                 if isinstance(v, (int, float)) and not isinstance(v, bool)}
                        for key in ('prompt_tokens_details', 'completion_tokens_details'):
                            details = event['usage'].get(key)
                            if isinstance(details, dict):
                                usage[key] = {k: v for k, v in details.items()
                                              if isinstance(v, (int, float)) and not isinstance(v, bool)}
                    for choice in event.get('choices', []):
                        if choice.get('index', 0) != 0:
                            continue
                        delta = choice.get('delta') or {}
                        thought, answer = delta.get('reasoning_content') or '', delta.get('content') or ''
                        if not isinstance(thought, str) or not isinstance(answer, str):
                            raise LlmGatewayError('流式模型片段类型无效')
                        has_activity = bool(thought.strip() or answer.strip())
                        answer, tagged_thought_chars = text_filter.feed(answer)
                        reasoning_chars += len(thought) + tagged_thought_chars
                        content_chars += len(answer)
                        content.append(answer)
                        if has_activity:
                            last_activity = time.monotonic()
                            first_fragment = first_activity is None
                            if first_activity is None:
                                first_activity = last_activity-started
                            if progress and (first_fragment or last_activity-last_notice >= 15):
                                progress({'elapsed_seconds':round(last_activity-started, 1), 'reasoning_chars':reasoning_chars, 'content_chars':content_chars})
                                last_notice = last_activity
                        if choice.get('finish_reason'):
                            if choice['finish_reason'] != 'stop':
                                raise LlmGatewayError('流式模型未完整结束：'+str(choice['finish_reason']))
                            finished = True
                    if finished:
                        if not include_usage or usage is not None:
                            break
                        # Official streams send usage after finish_reason. Do not
                        # discard that terminal event or wait forever for it.
                        if usage_deadline is None:
                            usage_deadline = time.monotonic() + min(10, idle_timeout)
                if text_filter.mode == 'thinking':
                    raise LlmGatewayError('流式模型思考标记未完整结束')
                if not finished or not content_chars:
                    statuses = re.findall(r'^HTTP/\S+\s+(\d{3})',
                        response_headers.read_text(errors='replace') if response_headers.exists() else '', re.MULTILINE)
                    if statuses and int(statuses[-1]) >= 400:
                        raise LlmGatewayError('流式模型接口返回 HTTP '+statuses[-1])
                    exit_code = process.wait(timeout=5)
                    if exit_code:
                        raise LlmGatewayError(f'流式模型连接失败（curl退出码{exit_code}）')
                    raise LlmGatewayError('流式模型未返回完整答案（连接结束或接口拒绝）')
                return {'model':returned_model, 'choices':[{'message':{'content':''.join(content)}}],
                        'usage': usage,
                        'stream_metrics':{'seconds':time.monotonic()-started, 'first_activity_seconds':first_activity,
                                          'reasoning_chars':reasoning_chars, 'content_chars':content_chars, 'events':events}}
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
                worker.join(timeout=5)
                process.stdout.close()
