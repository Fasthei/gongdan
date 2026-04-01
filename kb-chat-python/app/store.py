import time
import uuid
from collections import defaultdict, deque
from typing import Any


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


sessions: dict[str, dict[str, Any]] = {}
messages: dict[str, list[dict[str, Any]]] = defaultdict(list)
branches: dict[str, list[dict[str, Any]]] = defaultdict(list)
runs: dict[str, dict[str, Any]] = {}
events: dict[str, list[dict[str, Any]]] = defaultdict(list)
checkpoints: dict[str, list[dict[str, Any]]] = defaultdict(list)
queue_by_session: dict[str, deque[str]] = defaultdict(deque)


def ensure_session(session_id: str | None = None) -> str:
    sid = session_id or gen_id("sess")
    if sid not in sessions:
        sessions[sid] = {
            "id": sid,
            "title": "新对话",
            "created_at": time.time(),
            "deleted": False,
        }
        branches[sid].append({"id": "main", "name": "main", "from_message_id": None, "created_at": time.time()})
    return sid


def emit(run_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    seq = len(events[run_id]) + 1
    event = {
        "run_id": run_id,
        "seq": seq,
        "type": event_type,
        "payload": payload,
        "ts": time.time(),
    }
    events[run_id].append(event)
    return event

