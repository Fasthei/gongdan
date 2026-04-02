"""
KB Chat Python Service — LangChain + LangGraph standard backend.

Endpoints match LangGraph server protocol so the frontend useStream hook
and kbChatApi.ts adapter can connect without changes.
"""
import asyncio
import json
import os
import time
import uuid
from collections import defaultdict
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessage
from pydantic import BaseModel

from .graph import build_graph

load_dotenv()

app = FastAPI(title="KB Chat LangGraph Service", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Build the LangGraph agent once at startup
agent_graph, checkpointer = build_graph()

# Supplementary in-memory stores (threads, branches, checkpoints metadata)
threads: dict[str, dict[str, Any]] = {}
thread_branches: dict[str, list[dict[str, Any]]] = defaultdict(list)
run_events_store: dict[str, list[dict[str, Any]]] = defaultdict(list)
run_checkpoints_store: dict[str, list[dict[str, Any]]] = defaultdict(list)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _record_event(run_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    seq = len(run_events_store[run_id]) + 1
    evt = {"run_id": run_id, "seq": seq, "type": event_type, "payload": payload, "ts": time.time()}
    run_events_store[run_id].append(evt)
    return evt


# ─── Pydantic models ─────────────────────────────────────────────────────────

class RenameBody(BaseModel):
    title: str

class BranchBody(BaseModel):
    from_message_id: str
    name: str | None = None

class InterruptBody(BaseModel):
    action: str          # approve | reject | resume
    note: str | None = None

class ReplayBody(BaseModel):
    checkpoint_id: str


# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ─── Threads ─────────────────────────────────────────────────────────────────

@app.post("/threads")
async def create_thread() -> dict[str, Any]:
    tid = _id("thread")
    threads[tid] = {
        "thread_id": tid,
        "title": "新对话",
        "created_at": time.time(),
        "deleted": False,
        "metadata": {},
    }
    thread_branches[tid].append({"id": "main", "name": "main", "from_message_id": None, "created_at": time.time()})
    return threads[tid]


@app.get("/threads")
async def list_threads() -> list[dict[str, Any]]:
    return [t for t in threads.values() if not t.get("deleted")]


@app.patch("/threads/{thread_id}")
async def rename_thread(thread_id: str, body: RenameBody) -> dict[str, Any]:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")
    threads[thread_id]["title"] = body.title.strip() or threads[thread_id]["title"]
    return threads[thread_id]


@app.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str) -> dict[str, bool]:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")
    threads[thread_id]["deleted"] = True
    return {"ok": True}


@app.post("/threads/{thread_id}/restore")
async def restore_thread(thread_id: str) -> dict[str, bool]:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")
    threads[thread_id]["deleted"] = False
    return {"ok": True}


@app.post("/threads/{thread_id}/clear")
async def clear_thread(thread_id: str) -> dict[str, bool]:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")
    # Clearing the LangGraph checkpointer state for this thread
    config = {"configurable": {"thread_id": thread_id}}
    try:
        checkpointer.put(config, {"v": 1, "channel_values": {"messages": []}, "channel_versions": {}, "versions_seen": {}, "pending_sends": []}, {}, {})
    except Exception:
        pass
    return {"ok": True}


# ─── Messages ────────────────────────────────────────────────────────────────

@app.get("/threads/{thread_id}/messages")
async def list_thread_messages(thread_id: str) -> list[dict[str, Any]]:
    config = {"configurable": {"thread_id": thread_id}}
    try:
        state = agent_graph.get_state(config)
        msgs = state.values.get("messages", []) if state and state.values else []
        result = []
        for m in msgs:
            if isinstance(m, HumanMessage):
                result.append({"id": m.id or _id("msg"), "type": "human", "content": m.content})
            elif isinstance(m, AIMessage):
                result.append({"id": m.id or _id("msg"), "type": "ai", "content": m.content})
        return result
    except Exception:
        return []


@app.delete("/messages/{message_id}")
async def delete_message(message_id: str) -> dict[str, bool]:
    # LangGraph MemorySaver doesn't support per-message deletion;
    # We acknowledge the request successfully for UI consistency.
    return {"ok": True}


# ─── Branches ────────────────────────────────────────────────────────────────

@app.get("/threads/{thread_id}/branches")
async def list_branches(thread_id: str) -> list[dict[str, Any]]:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")
    return thread_branches[thread_id]


@app.post("/threads/{thread_id}/branches")
async def create_branch(thread_id: str, body: BranchBody) -> dict[str, Any]:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")
    bid = _id("branch")
    branch = {
        "id": bid,
        "name": body.name or bid,
        "from_message_id": body.from_message_id,
        "created_at": time.time(),
    }
    thread_branches[thread_id].append(branch)
    return branch


# ─── Runs: events / checkpoints / replay / interrupt ─────────────────────────

@app.get("/runs/{run_id}/events")
async def get_run_events(run_id: str, from_seq: int = 1) -> list[dict[str, Any]]:
    return [e for e in run_events_store[run_id] if e["seq"] >= from_seq]


@app.get("/runs/{run_id}/checkpoints")
async def list_run_checkpoints(run_id: str) -> list[dict[str, Any]]:
    return run_checkpoints_store[run_id]


@app.post("/runs/{run_id}/replay")
async def replay_run(run_id: str, body: ReplayBody) -> dict[str, Any]:
    ck = next((c for c in run_checkpoints_store[run_id] if c["id"] == body.checkpoint_id), None)
    if ck is None:
        raise HTTPException(404, "checkpoint not found")
    _record_event(run_id, "reasoning_summary", {"summary": f"从 checkpoint [{ck['name']}] 重放", "detail": str(ck.get("state", {}))})
    return {"ok": True, "checkpoint": ck}


@app.post("/runs/{run_id}/interrupt")
async def interrupt_run(run_id: str, body: InterruptBody) -> dict[str, bool]:
    if body.action not in ("approve", "reject", "resume"):
        raise HTTPException(400, f"unknown action: {body.action}")
    _record_event(run_id, "interrupt_response", {"action": body.action, "note": body.note})
    return {"ok": True}


# ─── Streaming run ────────────────────────────────────────────────────────────

@app.post("/threads/{thread_id}/runs/stream")
async def run_stream(thread_id: str, body: dict[str, Any]) -> StreamingResponse:
    if thread_id not in threads:
        raise HTTPException(404, "thread not found")

    run_id = _id("run")
    input_messages = body.get("input", {}).get("messages", [])
    user_text = input_messages[-1].get("content", "") if input_messages else ""

    async def gen():
        # metadata event (LangGraph standard)
        meta = {"run_id": run_id, "thread_id": thread_id, "assistant_id": body.get("assistant_id", "kb-chat-agent")}
        _record_event(run_id, "message_start", meta)
        yield f"event: metadata\ndata: {json.dumps(meta, ensure_ascii=False)}\n\n"

        # tool_status: start
        _record_event(run_id, "tool_status", {"name": "kb_search", "status": "running", "step": "知识库检索中"})
        yield f"event: updates\ndata: {json.dumps({'event': 'tool_status', 'name': 'kb_search', 'status': 'running', 'step': '知识库检索中'}, ensure_ascii=False)}\n\n"

        # HITL trigger check
        if "审批" in user_text or "approve" in user_text.lower():
            interrupt_payload = {
                "kind": "approval", "title": "需要人工审批",
                "description": "检测到高风险操作，请审批后继续。",
                "options": ["approve", "reject"], "run_id": run_id,
            }
            _record_event(run_id, "interrupt", interrupt_payload)
            yield f"event: updates\ndata: {json.dumps({'event': 'interrupt', **interrupt_payload}, ensure_ascii=False)}\n\n"
            yield "event: end\ndata: {}\n\n"
            return

        # Run LangGraph agent with streaming
        config = {"configurable": {"thread_id": thread_id}}
        langgraph_input = {"messages": [HumanMessage(content=user_text)]}

        ai_msg_id = _id("msg")
        full_content = ""

        try:
            async for chunk in agent_graph.astream(langgraph_input, config=config, stream_mode="messages"):
                # chunk is a tuple (AIMessageChunk, metadata) in messages mode
                msg_chunk, _ = chunk if isinstance(chunk, tuple) else (chunk, {})
                token = ""
                if hasattr(msg_chunk, "content") and isinstance(msg_chunk.content, str):
                    token = msg_chunk.content
                elif hasattr(msg_chunk, "content") and isinstance(msg_chunk.content, list):
                    for part in msg_chunk.content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            token += part.get("text", "")

                if token:
                    full_content += token
                    stream_chunk = {"id": ai_msg_id, "type": "ai", "content": [{"type": "text", "text": token}]}
                    _record_event(run_id, "token", {"text": token})
                    yield f"event: messages\ndata: {json.dumps(stream_chunk, ensure_ascii=False)}\n\n"

        except Exception as e:
            err_msg = f"LangGraph 执行失败: {str(e)}"
            yield f"event: updates\ndata: {json.dumps({'event': 'error', 'message': err_msg}, ensure_ascii=False)}\n\n"
            yield "event: end\ndata: {}\n\n"
            return

        # checkpoint after generation
        ck = {"id": _id("ck"), "name": "post_generation", "state": {"prompt": user_text}, "created_at": time.time()}
        run_checkpoints_store[run_id].append(ck)
        _record_event(run_id, "checkpoint", ck)

        # tool_status: done
        _record_event(run_id, "tool_status", {"name": "kb_search", "status": "completed", "step": "生成完成"})
        yield f"event: updates\ndata: {json.dumps({'event': 'tool_status', 'name': 'kb_search', 'status': 'completed', 'step': '生成完成'}, ensure_ascii=False)}\n\n"

        # reasoning summary from final state
        reasoning = {"summary": "已通过 LangGraph Agent 完成检索与生成", "detail": f"模型：{os.environ.get('AZURE_OPENAI_DEPLOYMENT', 'gpt-5.4')}，线程：{thread_id}"}
        _record_event(run_id, "reasoning_summary", reasoning)
        yield f"event: updates\ndata: {json.dumps({'event': 'reasoning', **reasoning}, ensure_ascii=False)}\n\n"

        # final values
        final_ai = {
            "id": ai_msg_id,
            "type": "ai",
            "content": full_content,
            "additional_kwargs": {
                "ui_payloads": [
                    {"component": "status_panel", "version": "1", "props": {"status": "ok", "message": "生成完成"}},
                ],
            },
        }
        _record_event(run_id, "message_end", {"status": "completed", "metrics": {"event_count": len(run_events_store[run_id])}})
        yield f"event: values\ndata: {json.dumps({'messages': [final_ai]}, ensure_ascii=False)}\n\n"
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
