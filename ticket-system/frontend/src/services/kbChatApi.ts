import { apiUrl } from '../config/apiBase';
import { KbEvent } from '../types/kbChat';

function kbBase() {
  const origin = (
    import.meta.env.VITE_KB_CHAT_API_ORIGIN ||
    'https://aichatgongdan-dna6ghavchd9h6e0.eastasia-01.azurewebsites.net'
  )
    .trim()
    .replace(/\/$/, '');
  if (origin) return `${origin}/api/kb-chat`;
  return apiUrl('/api/kb-chat');
}

export async function getContracts() {
  const res = await fetch(`${kbBase()}/contracts`);
  return res.json();
}

export async function listSessions() {
  const res = await fetch(`${kbBase()}/sessions`);
  return res.json();
}

export async function createSession() {
  const res = await fetch(`${kbBase()}/sessions`, { method: 'POST' });
  return res.json();
}

export async function deleteSession(sessionId: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}`, { method: 'DELETE' });
  return res.json();
}

export async function restoreSession(sessionId: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}/restore`, { method: 'POST' });
  return res.json();
}

export async function renameSession(sessionId: string, title: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function clearSession(sessionId: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}/clear`, { method: 'POST' });
  return res.json();
}

export async function listBranches(sessionId: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}/branches`);
  return res.json();
}

export async function createBranch(sessionId: string, fromMessageId: string, name?: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_message_id: fromMessageId, name }),
  });
  return res.json();
}

export async function listMessages(sessionId: string, branchId: string) {
  const res = await fetch(`${kbBase()}/sessions/${sessionId}/messages?branch_id=${encodeURIComponent(branchId)}`);
  return res.json();
}

export async function deleteMessage(messageId: string) {
  const res = await fetch(`${kbBase()}/messages/${messageId}`, { method: 'DELETE' });
  return res.json();
}

export async function interruptRun(runId: string, action: 'approve' | 'reject' | 'resume', note?: string) {
  const res = await fetch(`${kbBase()}/runs/${runId}/interrupt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, note }),
  });
  return res.json();
}

export async function listCheckpoints(runId: string) {
  const res = await fetch(`${kbBase()}/runs/${runId}/checkpoints`);
  return res.json();
}

export async function replayRun(runId: string, checkpointId: string) {
  const res = await fetch(`${kbBase()}/runs/${runId}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkpoint_id: checkpointId }),
  });
  return res.json();
}

export async function getRunEvents(runId: string, fromSeq = 1) {
  const res = await fetch(`${kbBase()}/runs/${runId}/events?from_seq=${fromSeq}`);
  return res.json();
}

export async function streamChat(
  payload: { session_id?: string; prompt: string; branch_id: string; metadata?: Record<string, any> },
  onEvent: (event: KbEvent) => void
) {
  const accessToken = localStorage.getItem('accessToken');
  const response = await fetch(`${kbBase()}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`);
  }

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
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (!dataLine) return;
      try {
        const parsed = JSON.parse(dataLine.slice(6)) as KbEvent;
        onEvent(parsed);
      } catch {
        // ignore malformed chunk
      }
    });
  }
}

