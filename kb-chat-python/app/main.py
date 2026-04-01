import asyncio
import json
import time
import uuid
from collections import defaultdict
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse


app = FastAPI(title="KB Chat LangGraph-Compatible Service", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

threads: dict[str, dict[str, Any]] = {}
thread_messages: dict[str, list[dict[str, Any]]] = defaultdict(list)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/threads")
async def create_thread() -> dict[str, Any]:
    thread_id = _id("thread")
    threads[thread_id] = {"thread_id": thread_id, "created_at": time.time(), "metadata": {}}
    return threads[thread_id]


@app.get("/threads")
async def list_threads() -> list[dict[str, Any]]:
    return list(threads.values())


@app.get("/threads/{thread_id}/messages")
async def list_thread_messages(thread_id: str) -> list[dict[str, Any]]:
    return thread_messages[thread_id]


@app.post("/threads/{thread_id}/runs/stream")
async def run_stream(thread_id: str, body: dict[str, Any]) -> StreamingResponse:
    run_id = _id("run")
    input_messages = body.get("input", {}).get("messages", [])
    user_text = ""
    if input_messages:
        user_text = input_messages[-1].get("content", "")
    user_msg = {"id": _id("msg"), "type": "human", "content": user_text}
    thread_messages[thread_id].append(user_msg)

    async def gen():
        # LangGraph-style metadata event
        yield f"event: metadata\ndata: {json.dumps({'run_id': run_id, 'thread_id': thread_id, 'assistant_id': body.get('assistant_id', 'kb-chat-agent')}, ensure_ascii=False)}\n\n"

        # updates stream mode (tool state)
        update_payload = {"event": "tool_status", "name": "kb_search", "status": "running", "step": "检索中"}
        yield f"event: updates\ndata: {json.dumps(update_payload, ensure_ascii=False)}\n\n"
        await asyncio.sleep(0.1)

        citations = [
            {"title": "Web 参考 A", "url": "https://example.com/a", "snippet": "参考摘要 A", "sourceType": "Web", "score": 0.88},
            {"title": "Web 参考 B", "url": "https://example.com/b", "snippet": "参考摘要 B", "sourceType": "Web", "score": 0.79},
        ]
        yield f"event: updates\ndata: {json.dumps({'event': 'citation', 'items': citations}, ensure_ascii=False)}\n\n"
        yield f"event: updates\ndata: {json.dumps({'event': 'reasoning', 'summary': '先检索后生成', 'detail': '调用知识库检索并重排后输出答案'}, ensure_ascii=False)}\n\n"

        answer = f"已按 LangGraph 标准流式协议处理你的问题：{user_text}"
        ai_msg_id = _id("msg")
        for ch in answer:
            chunk = {"id": ai_msg_id, "type": "ai", "content": [{"type": "text", "text": ch}]}
            yield f"event: messages\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.004)

        final_ai = {
            "id": ai_msg_id,
            "type": "ai",
            "content": answer,
            "additional_kwargs": {
                "citations": citations,
                "ui_payloads": [
                    {"component": "reference_list", "version": "1", "props": {"items": citations}},
                    {"component": "status_panel", "version": "1", "props": {"status": "ok", "message": "生成完成"}},
                ],
            },
        }
        thread_messages[thread_id].append(final_ai)
        yield f"event: values\ndata: {json.dumps({'messages': [final_ai]}, ensure_ascii=False)}\n\n"
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

