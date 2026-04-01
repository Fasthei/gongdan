# KB Chat Python Service

独立知识库对话后端（Python + FastAPI），服务现有前端 `ticket-system/frontend` 的知识库对话能力。

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

## Endpoints

- `GET /health`
- `GET /api/kb-chat/contracts`
- `GET /api/kb-chat/metrics`
- `POST /api/kb-chat/stream`
- `POST /api/kb-chat/sessions`
- `GET /api/kb-chat/sessions`
- `DELETE /api/kb-chat/sessions/{session_id}`
- `GET /api/kb-chat/sessions/{session_id}/messages?branch_id=main`
- `DELETE /api/kb-chat/messages/{message_id}`
- `GET /api/kb-chat/sessions/{session_id}/branches`
- `POST /api/kb-chat/sessions/{session_id}/branches`
- `GET /api/kb-chat/runs/{run_id}/events?from_seq=1`
- `GET /api/kb-chat/runs/{run_id}/checkpoints`
- `POST /api/kb-chat/runs/{run_id}/replay`
- `POST /api/kb-chat/runs/{run_id}/interrupt`
