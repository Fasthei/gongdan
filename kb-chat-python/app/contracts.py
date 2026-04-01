from typing import Any, Literal

from pydantic import BaseModel, Field


RunStatus = Literal[
    "queued",
    "running",
    "interrupted",
    "waiting_human",
    "completed",
    "failed",
    "cancelled",
]

EventType = Literal[
    "message_start",
    "token",
    "reasoning_summary",
    "tool_status",
    "interrupt",
    "checkpoint",
    "ui_payload",
    "citation",
    "message_end",
    "error",
]


class StreamRequest(BaseModel):
    session_id: str | None = None
    prompt: str
    branch_id: str = "main"
    metadata: dict[str, Any] = Field(default_factory=dict)


class BranchRequest(BaseModel):
    from_message_id: str
    name: str | None = None


class ReplayRequest(BaseModel):
    checkpoint_id: str


class InterruptAction(BaseModel):
    action: Literal["approve", "reject", "resume"]
    note: str | None = None


class RenameSessionRequest(BaseModel):
    title: str

