"""Shared URL checks before choosing a page for script/parameter injection."""
import re
from urllib.parse import urlsplit


def url_matches_prefix(url: str, prefix: str) -> bool:
    try:
        target = urlsplit(url)
        expected = urlsplit(prefix)
        if expected.scheme not in {"http", "https"} or target.scheme != expected.scheme:
            return False
        if target.username is not None or expected.username is not None:
            return False
        target_host = (target.hostname or "").lower()
        expected_host = (expected.hostname or "").lower()
        if not target_host or not expected_host:
            return False
        default_port = 443 if expected.scheme == "https" else 80
        target_port = target.port if target.port is not None else default_port
        expected_port = expected.port if expected.port is not None else default_port
        if target_port != expected_port:
            return False
        if target_host != expected_host and not (
            expected_host == "agentseller.temu.com"
            and re.fullmatch(r"agentseller-[a-z0-9-]+\.temu\.com", target_host)
        ):
            return False
        return (target.path or "/").startswith(expected.path or "/")
    except (TypeError, ValueError):
        return False
