"""Durable submission guard; an interrupted submission is never safe to resend."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from core.one_xm_image import RejectedOneXMImageError

UNKNOWN_MESSAGE = '无法确认供应商是否已受理换脸，已暂停重复提交。请先核实供应商调用记录；原生成图仍保留。'


class SubmissionBlocked(Exception):
    code = 'UNKNOWN_SUBMIT_RESULT'


@contextmanager
def _connect(batch):
    path = Path(batch['json_path']).resolve().parent / 'face-swap-submissions.sqlite3'
    db = sqlite3.connect(path, timeout=10)
    db.execute('CREATE TABLE IF NOT EXISTS submissions (batch TEXT, asset TEXT, request TEXT, state TEXT, result TEXT, PRIMARY KEY(batch, request))')
    try:
        with db:
            yield db
    finally:
        db.close()


def blocked_assets(batch):
    with _connect(batch) as db:
        return {row[0] for row in db.execute("SELECT asset FROM submissions WHERE batch=? AND state IN ('submitting','unknown')", (batch['batch_id'],))}


def execute(batch, asset_id, request_id, generate):
    batch_id = batch['batch_id']
    with _connect(batch) as db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT asset, state, result FROM submissions WHERE batch=? AND request=?', (batch_id, request_id)).fetchone()
        if previous:
            if previous[0] != asset_id:
                raise ValueError('换脸请求编号与原图不匹配')
            if previous[1] == 'completed':
                return json.loads(previous[2])
            if previous[1] != 'rejected':
                raise SubmissionBlocked(UNKNOWN_MESSAGE)
        if db.execute("SELECT 1 FROM submissions WHERE batch=? AND asset=? AND state IN ('submitting','unknown')", (batch_id, asset_id)).fetchone():
            raise SubmissionBlocked(UNKNOWN_MESSAGE)
        db.execute('INSERT OR REPLACE INTO submissions VALUES (?,?,?,?,?)', (batch_id, asset_id, request_id, 'submitting', ''))
    try:
        result = generate()
    except RejectedOneXMImageError:
        with _connect(batch) as db:
            db.execute("UPDATE submissions SET state='rejected' WHERE batch=? AND request=?", (batch_id, request_id))
        raise
    except Exception as exc:
        with _connect(batch) as db:
            db.execute("UPDATE submissions SET state='unknown' WHERE batch=? AND request=?", (batch_id, request_id))
        # Do not persist arbitrary provider error text that could contain credentials.
        raise SubmissionBlocked(UNKNOWN_MESSAGE) from exc
    with _connect(batch) as db:
        db.execute("UPDATE submissions SET state='completed', result=? WHERE batch=? AND request=?", (json.dumps(result, ensure_ascii=False), batch_id, request_id))
    return result
