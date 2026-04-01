import { getApiOrigin } from '../config/apiBase';
import { KbEvent } from '../types/kbChat';

let cachedBase = '';

function kbBaseCandidates() {
  const envOrigin = (import.meta.env.VITE_KB_CHAT_API_ORIGIN || '').trim().replace(/\/$/, '');
  const appOrigin = (getApiOrigin() || '').trim().replace(/\/$/, '');
  const defaults = [
    envOrigin,
    appOrigin,
    'https://aichatgongdan-dna6ghavchd9h6e0.eastasia-01.azurewebsites.net',
  ].filter(Boolean);
  return Array.from(new Set(defaults));
}

function withAuthHeaders(init?: RequestInit): RequestInit {
  const accessToken = localStorage.getItem('accessToken');
  const headers = new Headers(init?.headers || {});
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return { ...init, headers };
}

async function fetchKb(path: string, init?: RequestInit) {
  const tries = cachedBase ? [cachedBase, ...kbBaseCandidates().filter((x) => x !== cachedBase)] : kbBaseCandidates();
  let lastError: any = null;
  for (const base of tries) {
    try {
      const res = await fetch(`${base}${path}`, withAuthHeaders(init));
      const ct = res.headers.get('content-type') || '';
      const looksJson = ct.includes('application/json');
      if (res.ok && looksJson) {
        cachedBase = base;
        return res;
      }
      lastError = new Error(`HTTP ${res.status} / non-json response from ${base}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('all kb endpoints failed');
}

export async function getContracts() {
  return { events: ['metadata', 'messages', 'updates', 'values', 'end'] };
}

export async function listSessions() {
  const res = await fetchKb('/threads');
  const rows = await res.json();
  return (rows || []).map((x: any) => ({ id: x.thread_id, title: x.thread_id }));
}

export async function createSession() {
  const res = await fetchKb('/threads', { method: 'POST' });
  const data = await res.json();
  return { id: data.thread_id, title: data.thread_id };
}

export async function deleteSession(sessionId: string) {
  // LangGraph server often doesn't support thread hard delete by default.
  return { ok: true };
}

export async function restoreSession(sessionId: string) {
  return { ok: true };
}

export async function renameSession(sessionId: string, title: string) {
  return { id: sessionId, title };
}

export async function clearSession(sessionId: string) {
  return { ok: true };
}

export async function listBranches(sessionId: string) {
  return [{ id: 'main', name: 'main' }];
}

export async function createBranch(sessionId: string, fromMessageId: string, name?: string) {
  return { id: `branch_${Date.now()}`, name: name || 'main' };
}

export async function listMessages(sessionId: string, branchId: string) {
  const res = await fetchKb(`/threads/${sessionId}/messages`);
  const rows = await res.json();
  return (rows || []).map((m: any) => ({
    id: m.id,
    role: m.type === 'human' ? 'user' : 'assistant',
    content: typeof m.content === 'string' ? m.content : '',
    branch_id: 'main',
  }));
}

export async function deleteMessage(messageId: string) {
  // no standard delete endpoint in simple thread server
  return { ok: true };
}

export async function interruptRun(runId: string, action: 'approve' | 'reject' | 'resume', note?: string) {
  return { ok: true };
}

export async function listCheckpoints(runId: string) {
  return [];
}

export async function replayRun(runId: string, checkpointId: string) {
  return { ok: true };
}

export async function getRunEvents(runId: string, fromSeq = 1) {
  return [];
}

export async function streamChat(
  payload: { session_id?: string; prompt: string; branch_id: string; metadata?: Record<string, any> },
  onEvent: (event: KbEvent) => void
) {
  if (!payload.session_id) {
    throw new Error('session_id is required');
  }
  const base = cachedBase || kbBaseCandidates()[0];
  const response = await fetch(
    `${base}/threads/${payload.session_id}/runs/stream`,
    withAuthHeaders({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistant_id: 'kb-chat-agent',
        input: { messages: [{ role: 'user', content: payload.prompt }] },
        stream_mode: ['messages', 'updates', 'values'],
      }),
    }),
  );

  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`);
  }
  cachedBase = base;

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';

    blocks.forEach((block) => {
      const lines = block.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event: '));
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (!dataLine) return;
      try {
        const eventName = eventLine?.slice(7).trim() || '';
        const raw = JSON.parse(dataLine.slice(6));
        if (eventName === 'metadata') onEvent({ run_id: raw.run_id, seq: Date.now(), type: 'message_start', payload: raw, ts: Date.now() });
        if (eventName === 'updates' && raw.event === 'tool_status') onEvent({ run_id: 'run', seq: Date.now(), type: 'tool_status', payload: raw, ts: Date.now() });
        if (eventName === 'updates' && raw.event === 'reasoning') onEvent({ run_id: 'run', seq: Date.now(), type: 'reasoning_summary', payload: raw, ts: Date.now() });
        if (eventName === 'updates' && raw.event === 'citation') onEvent({ run_id: 'run', seq: Date.now(), type: 'citation', payload: raw, ts: Date.now() });
        if (eventName === 'messages') onEvent({ run_id: 'run', seq: Date.now(), type: 'token', payload: { text: raw?.content?.[0]?.text || '' }, ts: Date.now() });
        if (eventName === 'values') {
          const last = raw?.messages?.[0];
          const payloads = last?.additional_kwargs?.ui_payloads || [];
          payloads.forEach((p: any) => onEvent({ run_id: 'run', seq: Date.now(), type: 'ui_payload', payload: p, ts: Date.now() }));
          onEvent({ run_id: 'run', seq: Date.now(), type: 'message_end', payload: {}, ts: Date.now() });
        }
      } catch {
        // ignore malformed chunk
      }
    });
  }
}

