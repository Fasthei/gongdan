export type RunStatus =
  | 'queued'
  | 'running'
  | 'interrupted'
  | 'waiting_human'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type KbEventType =
  | 'message_start'
  | 'token'
  | 'reasoning_summary'
  | 'tool_status'
  | 'interrupt'
  | 'checkpoint'
  | 'ui_payload'
  | 'citation'
  | 'message_end'
  | 'error';

export interface KbEvent {
  run_id: string;
  seq: number;
  type: KbEventType;
  payload: any;
  ts: number;
}

export interface UiPayload {
  component: string;
  version: string;
  props: Record<string, any>;
  fallback_text?: string;
}

export interface Citation {
  title: string;
  url: string;
  snippet: string;
  sourceType: string;
  score?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  branch_id: string;
  created_at?: number;
  deleted?: boolean;
}

