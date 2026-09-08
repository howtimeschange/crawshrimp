"""Cooperative boundary for cloud lease/cancellation checks.

Context-local so unrelated desktop tasks are unaffected. asyncio tasks and
asyncio.to_thread inherit this context; the owner resets it in a finally block.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Callable

_checkpoint: ContextVar[Callable[[], None] | None] = ContextVar('execution_checkpoint', default=None)


def check_execution() -> None:
    callback = _checkpoint.get()
    if callback is not None:
        callback()


def has_execution_checkpoint() -> bool:
    return _checkpoint.get() is not None


@contextmanager
def execution_checkpoint(callback: Callable[[], None]):
    token = _checkpoint.set(callback)
    try:
        check_execution()
        yield
    finally:
        _checkpoint.reset(token)
