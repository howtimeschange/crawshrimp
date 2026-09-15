import contextlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from core.llm_gateway import LlmGatewayError
from core.llm_stream import post_json_stream


@contextlib.contextmanager
def server(events, status=200):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            self.send_response(status() if callable(status) else status)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            try:
                for delay, data in events:
                    time.sleep(delay)
                    self.wfile.write(data.encode()); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
    try:
        yield f'http://127.0.0.1:{httpd.server_port}/chat/completions'
    finally:
        httpd.shutdown(); httpd.server_close(); thread.join()


def delta(**fields):
    return 'data: '+json.dumps({'choices':[{'delta':fields}]})+'\n\n'


def test_stream_active_reasoning_can_exceed_original_total_deadline():
    with server([(.03, delta(reasoning_content='thinking')) for _ in range(6)] +
                [(0, delta(content='{"match":true}')), (0, 'data: [DONE]\n\n')]) as url:
        result = post_json_stream(url, {'model':'test'}, {}, idle_timeout=.15)
    assert result['choices'][0]['message']['content'] == '{"match":true}'
    assert result['stream_metrics']['seconds'] > .15
    assert result['stream_metrics']['reasoning_chars'] == 48


def test_empty_heartbeats_do_not_extend_activity_deadline():
    with server([(.03, ': keepalive\n\n')] * 12) as url:
        with pytest.raises(LlmGatewayError, match='没有有效'):
            post_json_stream(url, {'model':'test'}, {}, idle_timeout=.15)


def test_disconnect_after_partial_answer_is_not_success():
    with server([(0, delta(content='{"match":'))]) as url:
        with pytest.raises(LlmGatewayError, match='未返回完整答案'):
            post_json_stream(url, {'model':'test'}, {}, idle_timeout=1)


def test_truncated_answer_rejected_even_if_it_is_json():
    data='data: '+json.dumps({'choices':[{'delta':{'content':'{}'},'finish_reason':'length'}]})+'\n\n'
    with server([(0, data)]) as url:
        with pytest.raises(LlmGatewayError, match='未完整结束'):
            post_json_stream(url, {'model':'test'}, {}, idle_timeout=1)


def test_http_payment_error_keeps_status_without_secret_body():
    with server([(0, 'private provider details')], status=402) as url:
        with pytest.raises(LlmGatewayError, match='HTTP 402') as caught:
            post_json_stream(url, {'model':'test'}, {}, idle_timeout=1)
    assert 'private' not in str(caught.value)


def test_stop_event_completes_without_waiting_for_done():
    data='data: '+json.dumps({'choices':[{'delta':{'content':'{}'},'finish_reason':'stop'}]})+'\n\n'
    with server([(0, data), (.4, ': heartbeat\n\n')]) as url:
        result=post_json_stream(url, {'model':'test'}, {}, idle_timeout=.2)
    assert result['choices'][0]['message']['content'] == '{}'


def test_gateway_think_tags_split_across_chunks_do_not_contaminate_json():
    parts = ['<thi', 'nk>', 'private {analysis}', '</th', 'ink>', '\n', '{"match":true}']
    with server([(0, delta(content=p)) for p in parts] + [(0, 'data: [DONE]\n\n')]) as url:
        result = post_json_stream(url, {'model':'test'}, {}, idle_timeout=1)
    assert json.loads(result['choices'][0]['message']['content']) == {'match':True}
    assert result['stream_metrics']['reasoning_chars'] == len('private {analysis}')


def test_unclosed_think_tag_is_not_accepted_as_json():
    with server([(0, delta(content='<think>{"match":true}')), (0, 'data: [DONE]\n\n')]) as url:
        with pytest.raises(LlmGatewayError, match='思考标记未完整结束'):
            post_json_stream(url, {'model':'test'}, {}, idle_timeout=1)


def test_real_transport_503_retries_twice_then_returns_complete_json(monkeypatch):
    from functools import partial
    from core import llm_gateway as gateway, shenhui_shoe_models as models
    count=[0]; waits=[]; logs=[]
    def status():
        count[0]+=1
        return 503 if count[0]<3 else 200
    with server([(0, delta(content='{"match":true}')), (0, 'data: [DONE]\n\n')],status=status) as url:
        monkeypatch.setattr(gateway,'route_for_model',lambda *a,**k:gateway.LlmRoute(
            model_id='gpt-6-astra',protocol='openai',base_url=url,api_key='test-key'))
        result,actual=models.generate_json(models=['gpt-6-astra'],sleep=waits.append,log=logs.append,
            system_prompt='JSON',user_prompt='match',image_inputs=['data:image/png;base64,aA=='],
            timeout_seconds=1,request_openai=partial(models.stream_request))
    assert count[0]==3 and waits==[1,3]
    assert result=={'match':True} and actual.model_id=='gpt-6-astra'
    assert sum('HTTP 503' in line for line in logs)==2
