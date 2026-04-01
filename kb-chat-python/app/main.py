import asyncio
import json
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .contracts import BranchRequest, InterruptAction, RenameSessionRequest, ReplayRequest, StreamRequest
from .store import branches, checkpoints, emit, ensure_session, events, gen_id, messages, queue_by_session, runs, sessions


app = FastAPI(title="KB Chat Python Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def run_pipeline(run: dict[str, Any], prompt: str) -> None:
    run_id = run["id"]
    run["status"] = "running"
    emit(run_id, "message_start", {"session_id": run["session_id"], "branch_id": run["branch_id"], "trace_id": run_id})
    emit(run_id, "reasoning_summary", {"summary": "检索并重排后生成", "detail": "先调用检索工具，再输出带引用答案。"})
    emit(run_id, "tool_status", {"name": "kb_search", "status": "running", "step": "检索中", "input": {"query": prompt}})
    await asyncio.sleep(0.1)

    refs = [
        {"title": "Web 参考 A", "url": "https://example.com/a", "snippet": "参考摘要 A", "sourceType": "Web", "score": 0.88},
        {"title": "Web 参考 B", "url": "https://example.com/b", "snippet": "参考摘要 B", "sourceType": "Web", "score": 0.79},
    ]
    emit(run_id, "tool_status", {"name": "kb_search", "status": "completed", "step": "检索完成", "output": {"citations": refs}})
    citation_items = refs if refs else [{"title": "无可引用来源", "url": "", "snippet": "当前检索未返回有效引用。", "sourceType": "Web", "score": 0}]
    emit(run_id, "citation", {"items": citation_items})

    ck = {"id": gen_id("ck"), "name": "post_retrieval", "state": {"prompt": prompt}, "created_at": time.time()}
    checkpoints[run_id].append(ck)
    emit(run_id, "checkpoint", ck)

    if "审批" in prompt or "approve" in prompt.lower():
        run["status"] = "waiting_human"
        emit(
            run_id,
            "interrupt",
            {"kind": "approval", "title": "需要人工审批", "description": "检测到高风险操作，请审批后继续。", "options": ["approve", "reject"]},
        )
        return

    answer = f"已处理你的问题：{prompt}\n\n以下是结合知识库的回答示例。"
    first_token_at = None
    for ch in answer:
        if first_token_at is None:
            first_token_at = time.time()
        emit(run_id, "token", {"text": ch})
        await asyncio.sleep(0.005)

    emit(run_id, "ui_payload", {"component": "reference_list", "version": "1", "props": {"items": citation_items}, "fallback_text": "参考资料"})
    run["status"] = "completed"
    emit(
        run_id,
        "message_end",
        {
            "status": run["status"],
            "usage": {"prompt_tokens": 32, "completion_tokens": len(answer)},
            "metrics": {
                "ttft_ms": int(((first_token_at or time.time()) - run["created_at"]) * 1000),
                "event_count": len(events[run_id]),
            },
            "traceId": run_id,
        },
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/kb-chat/contracts")
async def get_contracts() -> dict[str, Any]:
    return {
        "run_status": ["queued", "running", "interrupted", "waiting_human", "completed", "failed", "cancelled"],
        "events": ["message_start", "token", "reasoning_summary", "tool_status", "interrupt", "checkpoint", "ui_payload", "citation", "message_end", "error"],
    }


@app.get("/api/kb-chat/metrics")
async def get_metrics() -> dict[str, Any]:
    done_runs = [r for r in runs.values() if r["status"] in {"completed", "cancelled", "failed"}]
    return {
        "sessions": len([s for s in sessions.values() if not s["deleted"]]),
        "runs_total": len(runs),
        "runs_done": len(done_runs),
        "events_total": sum(len(v) for v in events.values()),
    }


@app.post("/api/kb-chat/sessions")
async def create_session() -> dict[str, Any]:
    sid = ensure_session()
    return sessions[sid]


@app.get("/api/kb-chat/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    return [s for s in sessions.values() if not s["deleted"]]


@app.delete("/api/kb-chat/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, bool]:
    if session_id not in sessions:
        raise HTTPException(404, "session not found")
    sessions[session_id]["deleted"] = True
    return {"ok": True}


@app.post("/api/kb-chat/sessions/{session_id}/restore")
async def restore_session(session_id: str) -> dict[str, bool]:
    if session_id not in sessions:
        raise HTTPException(404, "session not found")
    sessions[session_id]["deleted"] = False
    return {"ok": True}


@app.patch("/api/kb-chat/sessions/{session_id}")
async def rename_session(session_id: str, body: RenameSessionRequest) -> dict[str, Any]:
    if session_id not in sessions:
        raise HTTPException(404, "session not found")
    sessions[session_id]["title"] = body.title.strip() or sessions[session_id]["title"]
    return sessions[session_id]


@app.post("/api/kb-chat/sessions/{session_id}/clear")
async def clear_session_context(session_id: str) -> dict[str, bool]:
    if session_id not in sessions:
        raise HTTPException(404, "session not found")
    for m in messages[session_id]:
        m["deleted"] = True
    return {"ok": True}


@app.get("/api/kb-chat/sessions/{session_id}/messages")
async def get_messages(session_id: str, branch_id: str = "main") -> list[dict[str, Any]]:
    return [m for m in messages[session_id] if m["branch_id"] == branch_id and not m.get("deleted")]


@app.delete("/api/kb-chat/messages/{message_id}")
async def delete_message(message_id: str) -> dict[str, bool]:
    for sid, items in messages.items():
        for m in items:
            if m["id"] == message_id:
                m["deleted"] = True
                return {"ok": True}
    raise HTTPException(404, "message not found")


@app.get("/api/kb-chat/sessions/{session_id}/branches")
async def list_branches(session_id: str) -> list[dict[str, Any]]:
    ensure_session(session_id)
    return branches[session_id]


@app.post("/api/kb-chat/sessions/{session_id}/branches")
async def create_branch(session_id: str, body: BranchRequest) -> dict[str, Any]:
    ensure_session(session_id)
    bid = gen_id("branch")
    item = {"id": bid, "name": body.name or bid, "from_message_id": body.from_message_id, "created_at": time.time()}
    branches[session_id].append(item)
    return item


@app.get("/api/kb-chat/runs/{run_id}/events")
async def get_run_events(run_id: str, from_seq: int = 1) -> list[dict[str, Any]]:
    return [e for e in events[run_id] if e["seq"] >= from_seq]


@app.get("/api/kb-chat/runs/{run_id}/checkpoints")
async def get_run_checkpoints(run_id: str) -> list[dict[str, Any]]:
    return checkpoints[run_id]


@app.post("/api/kb-chat/runs/{run_id}/replay")
async def replay_run(run_id: str, body: ReplayRequest) -> dict[str, Any]:
    if run_id not in runs:
        raise HTTPException(404, "run not found")
    emit(run_id, "reasoning_summary", {"summary": f"从 checkpoint {body.checkpoint_id} 重放"})
    emit(run_id, "token", {"text": "重放完成。"})
    return {"ok": True}


@app.post("/api/kb-chat/runs/{run_id}/interrupt")
async def interrupt_action(run_id: str, body: InterruptAction) -> dict[str, Any]:
    if run_id not in runs:
        raise HTTPException(404, "run not found")
    run = runs[run_id]
    if body.action == "reject":
        run["status"] = "cancelled"
        emit(run_id, "message_end", {"status": run["status"], "traceId": run_id})
        return {"ok": True}
    run["status"] = "running"
    emit(run_id, "reasoning_summary", {"summary": f"人工操作：{body.action}"})
    emit(run_id, "token", {"text": "已根据人工审批继续执行。"})
    run["status"] = "completed"
    emit(run_id, "message_end", {"status": run["status"], "traceId": run_id})
    return {"ok": True}


@app.post("/api/kb-chat/stream")
async def stream_chat(body: StreamRequest) -> StreamingResponse:
    sid = ensure_session(body.session_id)
    queue_by_session[sid].append("queued")
    run = {"id": gen_id("run"), "session_id": sid, "branch_id": body.branch_id, "status": "queued", "created_at": time.time()}
    runs[run["id"]] = run
    messages[sid].append({"id": gen_id("msg"), "role": "user", "content": body.prompt, "branch_id": body.branch_id, "created_at": time.time()})

    async def event_generator():
        try:
            task = asyncio.create_task(run_pipeline(run, body.prompt))
            seen = 0
            while True:
                while seen < len(events[run["id"]]):
                    seen += 1
                    evt = events[run["id"]][seen - 1]
                    yield f"event: {evt['type']}\n".encode("utf-8")
                    yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n".encode("utf-8")
                if task.done() and run["status"] in {"completed", "cancelled", "failed", "waiting_human"}:
                    break
                await asyncio.sleep(0.03)
        finally:
            if queue_by_session[sid]:
                queue_by_session[sid].popleft()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

