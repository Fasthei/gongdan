import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createAgent, tool } from 'langchain';
import { KbStreamPayload, KbSideQueue, mergeAgentStreamAndQueue } from './kb-stream.events';

export interface KBSearchResult {
  id: string;
  title: string;
  content: string;
  platform?: string;
  score: number;
  /** 可打开的原文链接（网页 citation、Azure blob / metadata_storage_path、base64 编码的 URL id 等） */
  url?: string;
}

export interface KBSmartQueryResult {
  answer: string;
  sources: KBSearchResult[];
}

export interface KBChatMessage {
  role: 'user' | 'assistant';
  content: string;
  searchMode?: 'internal' | 'hybrid';
  createdAt?: string;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly aiSearchBaseUrl: string;
  private readonly llmBaseUrl: string;
  private readonly llmApiKey: string;
  private readonly llmPrimaryModel: string;
  private readonly llmFallbackModel: string;
  private sessionTableReady = false;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.baseUrl =
      this.config.get<string>('KB_AGENT_URL') ||
      'https://agnetdoc-cve0guf5h8eggmej.southeastasia-01.azurewebsites.net';
    this.apiKey = this.config.get<string>('KB_AGENT_API_KEY') || '';
    this.aiSearchBaseUrl =
      this.config.get<string>('AI_SEARCH_AGENT_URL') ||
      'https://aisousuo-gxe7hphbduetgqam.eastasia-01.azurewebsites.net/api';
    this.llmBaseUrl = this.config.get<string>('LLM_BASE_URL') || 'https://api.taijiaicloud.com/v1';
    this.llmApiKey = this.config.get<string>('LLM_API_KEY') || '';
    this.llmPrimaryModel = this.config.get<string>('LLM_PRIMARY_MODEL') || 'claude-sonnet-4-6';
    this.llmFallbackModel = this.config.get<string>('LLM_FALLBACK_MODEL') || 'gemini-3.1-flash-lite-preview';
  }

  private get headers() {
    return {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /** 内部 KB 常见：id 为 base64(http/https...) */
  private tryUrlFromBase64Id(id: string): string | undefined {
    if (!id || typeof id !== 'string' || id.length < 12) return;
    const normalized = id.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return;
    try {
      const pad = (4 - (normalized.length % 4)) % 4;
      const decoded = Buffer.from(normalized + '='.repeat(pad), 'base64').toString('utf8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch {
      /* ignore */
    }
  }

  private pickKbSourceUrl(item: any, fallbackId: string): string | undefined {
    const raw = [
      item?.url,
      item?.link,
      item?.source_url,
      item?.href,
      item?.sourceUrl,
      item?.page_url,
      item?.pageUrl,
      item?.document_url,
      item?.documentUrl,
    ];
    for (const c of raw) {
      if (typeof c === 'string' && /^https?:\/\//i.test(c.trim())) return c.trim();
    }
    const blobish =
      item?.metadata_storage_path ??
      item?.metadataStoragePath ??
      item?.storage_path ??
      item?.storagePath ??
      item?.blob_url;
    if (typeof blobish === 'string' && /^https?:\/\//i.test(blobish.trim())) return blobish.trim();
    return this.tryUrlFromBase64Id(fallbackId);
  }

  private mapKbSearchItem(item: any, idx: number): KBSearchResult {
    const id = String(item?.id ?? item?.key ?? idx);
    const title =
      item?.title ||
      item?.name ||
      (typeof item?.url === 'string' && !/^https?:\/\//i.test(item.url) ? item.url : '') ||
      '';
    const content = item?.content || item?.text || item?.snippet || '';
    const platform = item?.source || item?.platform || item?.domain || '';
    const score = Number(item?.['@search.score'] ?? item?.score ?? item?.confidence ?? 0);
    const url = this.pickKbSourceUrl(item, id);
    const r: KBSearchResult = {
      id,
      title: title || (url ? '引用' : '未命名资料'),
      content,
      platform: platform || undefined,
      score,
    };
    if (url) r.url = url;
    return r;
  }

  /**
   * 混合搜索（关键词 + 向量），支持 platform 过滤
   */
  async search(
    query: string,
    filters?: { platform?: string; topK?: number; searchMode?: 'hybrid' | 'keyword' | 'vector' },
  ): Promise<KBSearchResult[]> {
    if (!this.apiKey) {
      this.logger.debug(`[Mock KB] 搜索: "${query}"`);
      return [];
    }

    try {
      const body: Record<string, any> = {
        query,
        top: filters?.topK || 5,
        search_mode: filters?.searchMode || 'hybrid',
      };

      // platform 映射为 filter_expr
      if (filters?.platform) {
        body.filter_expr = `source eq '${filters.platform}'`;
      }

      const { data } = await axios.post(`${this.baseUrl}/api/v1/search`, body, {
        headers: this.headers,
        timeout: 8000,
      });

      // 兼容返回格式：{ results: [...] } 或直接数组
      const raw: any[] = Array.isArray(data) ? data : (data.results || data.value || []);

      return raw.map((item: any, i: number) => this.mapKbSearchItem(item, i));
    } catch (err) {
      this.logger.error(`知识库搜索失败: ${err.message}`);
      return [];
    }
  }

  /**
   * AI 智能问答，返回答案 + 来源文档
   */
  async smartQuery(question: string, topK = 5, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<KBSmartQueryResult> {
    if (!this.apiKey) {
      this.logger.debug(`[Mock KB Smart] 问题: "${question}"`);
      return { answer: '', sources: [] };
    }

    try {
      const { data } = await axios.post(
        `${this.baseUrl}/api/v1/smart-query`,
        { question, top: topK, history: history || [] },
        { headers: this.headers, timeout: 10000 },
      );

      const sources: KBSearchResult[] = (data.sources || data.results || []).map((item: any, i: number) =>
        this.mapKbSearchItem(item, i),
      );

      return { answer: data.answer || data.result || '', sources };
    } catch (err) {
      this.logger.error(`知识库智能问答失败: ${err.message}`);
      return { answer: '', sources: [] };
    }
  }

  /**
   * 根据工单详情自动搜索相关知识条目
   */
  async getRelatedArticles(description: string, platform?: string): Promise<KBSearchResult[]> {
    return this.search(description, { platform, topK: 5 });
  }

  async uploadDocument(file: any, metadata?: { platform?: string; title?: string }) {
    if (!file) {
      throw new Error('上传文件不能为空');
    }

    // Keep endpoint configurable because KB Agent versions may differ.
    const uploadPath = this.config.get<string>('KB_AGENT_UPLOAD_PATH') || '/api/v1/upload';
    const uploadUrl = `${this.baseUrl}${uploadPath}`;

    if (!this.apiKey) {
      this.logger.debug(`[Mock KB Upload] 文件: ${file.originalname}`);
      return {
        success: true,
        mock: true,
        fileName: file.originalname,
        platform: metadata?.platform || '',
        title: metadata?.title || '',
      };
    }

    try {
      const form = new FormData();
      form.append('file', file.buffer, file.originalname);
      if (metadata?.platform) form.append('platform', metadata.platform);
      if (metadata?.title) form.append('title', metadata.title);

      const { data } = await axios.post(uploadUrl, form, {
        headers: {
          ...form.getHeaders(),
          'api-key': this.apiKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000,
      });

      return data;
    } catch (err: any) {
      this.logger.error(`知识库资料上传失败: ${err.message}`);
      throw new Error(err.response?.data?.message || '知识库资料上传失败');
    }
  }

  private async ensureSessionTables() {
    if (this.sessionTableReady) return;
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS kb_chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_role TEXT NOT NULL,
        customer_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS kb_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        search_mode TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE kb_chat_messages
      ADD COLUMN IF NOT EXISTS search_mode TEXT;
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS kb_sandbox_audit_events (
        id TEXT PRIMARY KEY,
        audit_entry_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sandbox_id TEXT,
        action TEXT,
        target_type TEXT,
        target_id TEXT,
        status_code INTEGER,
        error_message TEXT,
        actor_id TEXT,
        actor_email TEXT,
        organization_id TEXT,
        metadata_json TEXT,
        audit_created_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS kb_sandbox_audit_events_session_idx
      ON kb_sandbox_audit_events (session_id);
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS kb_sandbox_audit_events_sandbox_idx
      ON kb_sandbox_audit_events (sandbox_id);
    `);
    this.sessionTableReady = true;
  }

  async getOrCreateSession(params: {
    sessionId?: string;
    userId: string;
    userRole: string;
    customerCode?: string;
  }) {
    await this.ensureSessionTables();
    const { sessionId, userId, userRole, customerCode } = params;
    if (sessionId) {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM kb_chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
        sessionId,
        userId,
      );
      if (rows.length > 0) return sessionId;
    }

    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO kb_chat_sessions (id, user_id, user_role, customer_code)
      VALUES ($1, $2, $3, $4)
      `,
      id,
      userId,
      userRole,
      customerCode || null,
    );
    return id;
  }

  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    searchMode?: 'internal' | 'hybrid',
  ) {
    await this.ensureSessionTables();
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO kb_chat_messages (id, session_id, role, content, search_mode)
      VALUES ($1, $2, $3, $4, $5)
      `,
      randomUUID(),
      sessionId,
      role,
      content,
      searchMode || null,
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE kb_chat_sessions SET updated_at = NOW() WHERE id = $1`,
      sessionId,
    );
  }

  async getUserSessions(userId: string) {
    await this.ensureSessionTables();
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, created_at as "createdAt", updated_at as "updatedAt"
      FROM kb_chat_sessions
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 50
      `,
      userId,
    );
    
    // We fetch the first message of each session to use as a title
    const sessionsWithTitles = await Promise.all(
      rows.map(async (row) => {
        const msgs = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT content FROM kb_chat_messages WHERE session_id = $1 AND role = 'user' ORDER BY created_at ASC LIMIT 1`,
          row.id
        );
        const title = msgs.length > 0 ? msgs[0].content : '新对话';
        return {
          id: row.id,
          title: title.length > 20 ? title.substring(0, 20) + '...' : title,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
    );
    
    return sessionsWithTitles;
  }

  async getSessionMessages(sessionId: string, userId: string): Promise<KBChatMessage[]> {
    await this.ensureSessionTables();
    const own = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM kb_chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      sessionId,
      userId,
    );
    if (own.length === 0) return [];

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT role, content, search_mode, created_at
      FROM kb_chat_messages
      WHERE session_id = $1
      ORDER BY created_at ASC
      `,
      sessionId,
    );
    return rows.map((r) => ({
      role: r.role,
      content: r.content,
      searchMode: (r.search_mode || undefined) as 'internal' | 'hybrid' | undefined,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  private normalizeAiSearchSources(data: any): KBSearchResult[] {
    const refs = data?.references || data?.sources || data?.results || [];
    if (!Array.isArray(refs)) return [];
    return refs.map((item: any, idx: number) => {
      const m = this.mapKbSearchItem(
        {
          ...item,
          title: item.title || item.name || (typeof item.url === 'string' ? item.url : ''),
        },
        idx,
      );
      if (!m.title || m.title === '未命名资料') m.title = 'AI Search Source';
      return m;
    });
  }

  /**
   * aisousuo /api/search 与 SSE result 事件的响应体对齐：
   * answer / answer.text、answer.confidence、answer.follow_up_questions、answer.citations[].trust_score
   */
  private mapAisousuoSearchResponse(data: any): {
    answer: string;
    sources: KBSearchResult[];
    followUps: string[];
    confidence?: number;
  } {
    if (!data || typeof data !== 'object') {
      return { answer: '', sources: [], followUps: [] };
    }
    const root = data.result && typeof data.result === 'object' ? data.result : data;
    const ans = root.answer;
    let answerText = '';
    let confidence: number | undefined;
    let followUps: string[] = [];
    const citations: any[] = [];

    if (typeof ans === 'string') {
      answerText = ans;
    } else if (ans && typeof ans === 'object') {
      answerText =
        (typeof ans.text === 'string' && ans.text) ||
        (typeof ans.content === 'string' && ans.content) ||
        (typeof ans.summary === 'string' && ans.summary) ||
        (typeof ans.message === 'string' && ans.message) ||
        (typeof ans.answer === 'string' ? ans.answer : '') ||
        '';
      if (typeof ans.confidence === 'number') confidence = ans.confidence;
      if (Array.isArray(ans.follow_up_questions)) followUps = [...ans.follow_up_questions];
      if (Array.isArray(ans.citations)) citations.push(...ans.citations);
    }

    if (!answerText) {
      answerText =
        (typeof root.summary === 'string' && root.summary) ||
        (typeof root.text === 'string' && root.text) ||
        '';
    }

    const sources: KBSearchResult[] =
      citations.length > 0
        ? citations.map((c: any, idx: number) =>
            this.mapKbSearchItem(
              {
                ...c,
                id: c.id ?? c.url ?? idx,
                title: c.title || c.name || '',
                content: c.snippet || c.text || c.content || '',
                platform: c.domain || c.source,
                score: c.trust_score ?? c.score ?? 0,
              },
              idx,
            ),
          )
        : this.normalizeAiSearchSources(root);

    if (followUps.length === 0 && Array.isArray(root.follow_up_questions)) followUps = [...root.follow_up_questions];
    if (followUps.length === 0 && Array.isArray(data.follow_up_questions)) followUps = [...data.follow_up_questions];
    if (followUps.length === 0 && Array.isArray(data.follow_ups)) followUps = [...data.follow_ups];

    if (confidence === undefined && typeof root.confidence === 'number') confidence = root.confidence;
    if (confidence === undefined && typeof data.confidence === 'number') confidence = data.confidence;

    return { answer: answerText, sources, followUps, confidence };
  }

  /** SSE 路径：未配置时默认 /search/stream；设为 false/off 则仅用同步 /search */
  private getAiSearchSsePath(): string | null {
    const v = this.config.get<string>('AI_SEARCH_SSE_PATH');
    if (v === 'false' || v === '0' || v === 'off') return null;
    const t = (v === undefined || v === null ? '/search/stream' : String(v)).trim();
    if (!t || t === 'false') return null;
    return t.startsWith('/') ? t : `/${t}`;
  }

  /**
   * aisousuo POST /api/search/stream
   * 事件：cache_hit, decomposed, expanded, round_*, llm_started, llm_token, result, audit
   */
  private async consumeAisousuoSearchSse(
    stream: NodeJS.ReadableStream,
    sideQueue: KbSideQueue,
  ): Promise<{
    answer: string;
    sources: KBSearchResult[];
    followUps: string[];
    confidence?: number;
  }> {
    let buffer = '';
    let fullLlm = '';
    let resultPayload: any = null;

    const statusEvents = new Set([
      'cache_hit',
      'decomposed',
      'expanded',
      'round_started',
      'round_finished',
      'llm_started',
      'audit',
    ]);

    const handleNamedEvent = (eventName: string, dataRaw: string) => {
      if (!dataRaw) return;
      let j: any;
      try {
        j = JSON.parse(dataRaw);
      } catch {
        return;
      }
      const ev = (eventName || j.event || j.type || '').trim();
      if (ev === 'llm_token') {
        const t = j.token ?? j.text ?? j.delta ?? j.content ?? '';
        if (typeof t === 'string' && t) {
          fullLlm += t;
          sideQueue.push({ type: 'ai_search_token', text: t });
        }
        return;
      }
      if (ev === 'result') {
        resultPayload = j.result !== undefined ? j.result : j.payload !== undefined ? j.payload : j;
        return;
      }
      if (statusEvents.has(ev)) {
        sideQueue.push({ type: 'status', phase: 'ai_search_sse', detail: ev, tool: 'external_ai_search' });
      }
    };

    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString();
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let eventName = '';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          const l = line.replace(/\r$/, '');
          if (l.startsWith('event:')) eventName = l.slice(6).trim();
          else if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
        }
        const dataRaw = dataLines.join('\n').trim();
        if (dataRaw) {
          if (eventName) {
            handleNamedEvent(eventName, dataRaw);
          } else {
            try {
              const j = JSON.parse(dataRaw);
              const ev = String(j.event || j.type || '').trim();
              if (!ev) {
                handleNamedEvent('result', dataRaw);
              } else if (j.data !== undefined) {
                handleNamedEvent(ev, typeof j.data === 'string' ? j.data : JSON.stringify(j.data));
              } else {
                handleNamedEvent(ev, dataRaw);
              }
            } catch {
              /* ignore non-JSON data line */
            }
          }
        }
        sep = buffer.indexOf('\n\n');
      }
    }

    const mapped = resultPayload
      ? this.mapAisousuoSearchResponse(resultPayload)
      : { answer: '', sources: [] as KBSearchResult[], followUps: [] as string[], confidence: undefined as number | undefined };
    if (!mapped.answer?.trim() && fullLlm.trim()) mapped.answer = fullLlm;
    return mapped;
  }

  async aiSearch(query: string) {
    try {
      const base = this.aiSearchBaseUrl.replace(/\/$/, '');
      const topK = Number(this.config.get<string>('AI_SEARCH_TOP_K_PAGES') || 3) || 3;
      const { data } = await axios.post(
        `${base}/search`,
        { query, top_k_pages: topK },
        { timeout: 120000 },
      );
      return this.mapAisousuoSearchResponse(data);
    } catch (err: any) {
      this.logger.warn(`AI 搜索调用失败: ${err.message}`);
      return { answer: '', sources: [], followUps: [], confidence: undefined };
    }
  }

  private createAgentModel(modelName: string, streaming = false) {
    return new ChatOpenAI({
      model: modelName,
      apiKey: this.llmApiKey,
      configuration: {
        baseURL: this.llmBaseUrl,
      },
      temperature: 0.2,
      timeout: 15000,
      maxRetries: 0,
      streaming,
    });
  }

  private chunkToLlmText(chunk: any): string {
    if (!chunk) return '';
    const c = chunk.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .map((part: any) => {
          if (typeof part?.text === 'string') return part.text;
          if (part?.type === 'text' && typeof part?.text === 'string') return part.text;
          return '';
        })
        .join('');
    }
    return '';
  }

  /**
   * 混合模式下优先走 aisousuo /api/search/stream（与 AI_SEARCH_SSE_PATH，默认 /search/stream）；
   * 失败或未启用时走同步 /api/search。
   */
  private async aiSearchWithOptionalSse(query: string, sideQueue: KbSideQueue) {
    const ssePath = this.getAiSearchSsePath();
    if (ssePath) {
      try {
        const base = this.aiSearchBaseUrl.replace(/\/$/, '');
        const url = `${base}${ssePath}`;
        const topK = Number(this.config.get<string>('AI_SEARCH_TOP_K_PAGES') || 3) || 3;
        const { data: stream } = await axios.post(
          url,
          { query, top_k_pages: topK },
          { responseType: 'stream', timeout: 120000 },
        );
        return await this.consumeAisousuoSearchSse(stream, sideQueue);
      } catch (err: any) {
        this.logger.warn(`AI Search SSE 失败，回退同步 /search: ${err?.message}`);
      }
    }
    return this.aiSearch(query);
  }

  /** 混合模式写入 system prompt，供模型综合（避免仅靠工具调用时模型跳过外部检索） */
  /** 在 Daytona 中执行客户提供的 shell/curl 片段，用于隔离复现 HTTP/CLI 请求 */
  private async runSandboxRequestExample(script: string): Promise<{ output: string; sandboxId?: string }> {
    const apiKey = this.config.get<string>('DAYTONA_API_KEY')?.trim();
    const apiUrl = this.config.get<string>('DAYTONA_API_URL')?.trim() || 'https://app.daytona.io/api';
    const target = (this.config.get<string>('DAYTONA_TARGET')?.trim() as 'us' | 'eu') || 'us';
    if (!apiKey) {
      throw new Error('未配置 DAYTONA_API_KEY，无法使用沙盒排错');
    }
    const maxScript = 32000;
    const capped =
      script.length > maxScript ? `${script.slice(0, maxScript)}\n# ... [脚本已截断]` : script;
    const { DaytonaSandbox } = await import('@langchain/daytona');
    const sb = await DaytonaSandbox.create({
      language: 'javascript',
      timeout: 180,
      target,
      labels: { app: 'ticket-kb-troubleshoot' },
      auth: { apiKey, apiUrl },
      initialFiles: { '/tmp/request.sh': capped },
    });
    const sandboxId = sb.id;
    try {
      await sb.execute('chmod +x /tmp/request.sh 2>/dev/null || true');
      const r = await sb.execute('bash -lc "bash /tmp/request.sh 2>&1"');
      const out = `${r.output || ''}${r.exitCode !== 0 ? `\n[exit code: ${r.exitCode}]` : ''}`;
      const maxOut = 12000;
      const output = out.length > maxOut ? `${out.slice(0, maxOut)}\n... [输出已截断]` : out;
      return { output, sandboxId };
    } catch (e: any) {
      const err = new Error(e?.message || String(e)) as Error & { sandboxId?: string };
      err.sandboxId = sandboxId;
      throw err;
    } finally {
      try {
        await sb.close();
      } catch (e: any) {
        this.logger.warn(`Daytona sandbox close: ${e?.message}`);
      }
    }
  }

  /**
   * 拉取 Daytona Audit 中与本次 sandbox 相关的条目并写入 PG（与 kb_chat_sessions 通过 session_id 关联）。
   * 见 https://www.daytona.io/docs/en/audit-logs/
   */
  private async persistDaytonaAuditForSandbox(params: {
    sessionId: string;
    userId: string;
    sandboxId?: string;
    runStartedAt: Date;
  }): Promise<void> {
    const { sessionId, userId, sandboxId, runStartedAt } = params;
    const apiKey = this.config.get<string>('DAYTONA_API_KEY')?.trim();
    const rawFetch = (this.config.get<string>('DAYTONA_AUDIT_FETCH') ?? '').trim().toLowerCase();
    const auditDisabled = rawFetch === 'false' || rawFetch === '0' || rawFetch === 'off';
    if (auditDisabled || !apiKey) return;
    if (!sandboxId?.trim()) {
      this.logger.debug('Daytona audit：无 sandboxId，跳过拉取');
      return;
    }

    const apiBase = (this.config.get<string>('DAYTONA_API_URL')?.trim() || 'https://app.daytona.io/api').replace(
      /\/$/,
      '',
    );
    const orgId = this.config.get<string>('DAYTONA_ORGANIZATION_ID')?.trim();
    const auditUrl = orgId
      ? `${apiBase}/audit/organizations/${encodeURIComponent(orgId)}`
      : `${apiBase}/audit`;

    await this.ensureSessionTables();

    const since = new Date(runStartedAt.getTime() - 120_000);
    const sinceIso = since.toISOString();

    const delayMs = Math.min(Number(this.config.get<string>('DAYTONA_AUDIT_DELAY_MS') || '2000') || 0, 30_000);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    let rows: any[] = [];
    try {
      const res = await axios.get(auditUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 20000,
        validateStatus: () => true,
      });
      if (res.status < 200 || res.status >= 300) {
        const hint =
          typeof res.data === 'string'
            ? res.data.slice(0, 240)
            : res.data != null
              ? JSON.stringify(res.data).slice(0, 240)
              : '';
        this.logger.warn(`Daytona audit HTTP ${res.status}${hint ? `: ${hint}` : ''}`);
        return;
      }
      const data = res.data;
      const raw =
        Array.isArray(data) ? data : data?.items ?? data?.data ?? data?.logs ?? data?.auditLogs ?? [];
      rows = Array.isArray(raw) ? raw : [];
    } catch (e: any) {
      this.logger.warn(`Daytona audit 拉取失败: ${e?.message}`);
      return;
    }

    const sid = sandboxId.trim();
    const matchesSandbox = (entry: any): boolean => {
      if (!entry || typeof entry !== 'object') return false;
      const tid = entry.targetId != null ? String(entry.targetId) : '';
      if (tid === sid) return true;
      const meta = entry.metadata;
      if (meta && typeof meta === 'object') {
        let ms = '';
        if (meta.sandboxId != null) ms = String(meta.sandboxId);
        else if (meta.sandbox_id != null) ms = String(meta.sandbox_id);
        else if (meta.id != null) ms = String(meta.id);
        if (ms === sid) return true;
      }
      try {
        if (meta != null && JSON.stringify(meta).includes(sid)) return true;
      } catch {
        /* ignore */
      }
      return false;
    };

    const parseCreated = (entry: any): Date | null => {
      const t = entry?.createdAt ?? entry?.created_at;
      if (typeof t !== 'string') return null;
      const d = new Date(t);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    let matched = 0;
    for (const entry of rows) {
      if (!matchesSandbox(entry)) continue;
      const created = parseCreated(entry);
      if (created && created.toISOString() < sinceIso) continue;

      const auditEntryId = entry.id != null ? String(entry.id) : '';
      if (!auditEntryId) continue;

      matched += 1;

      const metadataJson =
        entry.metadata !== undefined
          ? typeof entry.metadata === 'string'
            ? entry.metadata
            : JSON.stringify(entry.metadata)
          : null;

      const rowId = randomUUID();
      const statusCode =
        entry.statusCode != null && entry.statusCode !== ''
          ? Number(entry.statusCode)
          : null;

      try {
        await this.prisma.$executeRawUnsafe(
          `
          INSERT INTO kb_sandbox_audit_events (
            id, audit_entry_id, session_id, user_id, sandbox_id,
            action, target_type, target_id, status_code, error_message,
            actor_id, actor_email, organization_id, metadata_json, audit_created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (audit_entry_id) DO NOTHING
          `,
          rowId,
          auditEntryId,
          sessionId,
          userId,
          sid,
          entry.action != null ? String(entry.action) : null,
          entry.targetType != null ? String(entry.targetType) : null,
          entry.targetId != null ? String(entry.targetId) : null,
          Number.isFinite(statusCode as number) ? statusCode : null,
          entry.errorMessage != null ? String(entry.errorMessage) : null,
          entry.actorId != null ? String(entry.actorId) : null,
          entry.actorEmail != null ? String(entry.actorEmail) : null,
          entry.organizationId != null ? String(entry.organizationId) : orgId || null,
          metadataJson,
          created ? created.toISOString() : null,
        );
      } catch (ins: any) {
        this.logger.warn(`Daytona audit 写入 PG 失败: ${ins?.message}`);
      }
    }

    if (matched > 0) {
      this.logger.log(
        `Daytona audit：会话 ${sessionId} / sandbox ${sid} 时间窗内匹配 ${matched} 条审计事件（已尝试落库，重复 audit_entry_id 会忽略）`,
      );
    }
  }

  /** 合并用户描述、请求示例与沙盒输出，供知识库/外部检索 */
  private buildTriageRetrievalQuery(
    question: string,
    requestExample: string | undefined,
    sandboxLog: string,
  ): string {
    if (!requestExample?.trim() && !sandboxLog.trim()) return question;
    return [
      question,
      '--- 客户请求示例（节选） ---',
      (requestExample || '').trim().slice(0, 4000),
      '--- 沙盒执行输出（节选） ---',
      sandboxLog.trim().slice(0, 6000),
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatHybridFactsForPrompt(
    intRes: KBSmartQueryResult,
    extRes: { answer: string; sources: KBSearchResult[] },
  ): string {
    const cap = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}…` : s || '（无）');
    const titles = (items: KBSearchResult[], m = 8) =>
      (items || []).slice(0, m).map((r) => r.title || r.id).filter(Boolean).join('；') || '无';
    return [
      '### 内部知识库',
      cap(intRes.answer || ''),
      `来源标题：${titles(intRes.sources)}`,
      '',
      '### 外部 AI 搜索',
      cap(extRes.answer || ''),
      `来源标题：${titles(extRes.sources)}`,
    ].join('\n');
  }

  private async *streamChatWithAgent(params: {
    sessionId: string;
    userId: string;
    question: string;
    history: KBChatMessage[];
    usedSearchMode: 'internal' | 'hybrid';
    sideQueue: KbSideQueue;
    useSandbox?: boolean;
    requestExample?: string;
  }): AsyncGenerator<KbStreamPayload> {
    const { sessionId, userId, question, history, usedSearchMode, sideQueue, useSandbox, requestExample } =
      params;
    const historyChat = history.slice(-10).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));
    const historyForKb = [...historyChat, { role: 'user' as const, content: question }].slice(-10);

    let sandboxLog = '';
    if (useSandbox && requestExample?.trim()) {
      const runStartedAt = new Date();
      sideQueue.push({ type: 'status', phase: 'sandbox', detail: 'start', tool: 'daytona' });
      let daytonaSandboxId: string | undefined;
      try {
        const run = await this.runSandboxRequestExample(requestExample.trim());
        sandboxLog = run.output;
        daytonaSandboxId = run.sandboxId;
      } catch (e: any) {
        sandboxLog = `【沙盒执行失败】${e?.message || String(e)}`;
        daytonaSandboxId = (e as Error & { sandboxId?: string })?.sandboxId;
        this.logger.warn(`Daytona: ${e?.message}`);
      }
      try {
        await this.persistDaytonaAuditForSandbox({
          sessionId,
          userId,
          sandboxId: daytonaSandboxId,
          runStartedAt,
        });
      } catch (auditErr: any) {
        this.logger.warn(`Daytona audit 持久化跳过: ${auditErr?.message}`);
      }
      sideQueue.push({ type: 'status', phase: 'sandbox', detail: 'done', tool: 'daytona' });
    }
    const retrievalQuery = this.buildTriageRetrievalQuery(question, requestExample, sandboxLog);

    const sourceBucket: KBSearchResult[] = [];
    let followUps: string[] = [];
    let confidence: number | undefined;
    const sourceDedupeKey = (s: KBSearchResult) =>
      (s.url?.trim() || s.id || `${s.title}::${s.platform || ''}`).slice(0, 512);
    const dedupeSource = (items: KBSearchResult[]) => {
      const seen = new Set(sourceBucket.map(sourceDedupeKey));
      for (const item of items) {
        const key = sourceDedupeKey(item);
        if (!seen.has(key)) {
          seen.add(key);
          sourceBucket.push(item);
        }
      }
    };

    const mkTools = (q: KbSideQueue) => {
      const internalTool = tool(
        async ({ question: qtext }: { question: string }) => {
          q.push({ type: 'status', phase: 'internal_kb', detail: 'start', tool: 'internal_kb_search' });
          const res = await this.smartQuery(
            [qtext, retrievalQuery !== question ? `\n${retrievalQuery.slice(0, 2000)}` : ''].join('').trim(),
            5,
            historyForKb,
          );
          dedupeSource(res.sources || []);
          q.push({ type: 'status', phase: 'internal_kb', detail: 'done', tool: 'internal_kb_search' });
          return JSON.stringify({
            answer: res.answer || '',
            sources: (res.sources || []).slice(0, 8),
          });
        },
        {
          name: 'internal_kb_search',
          description: '查询内部知识库并返回答案与来源文档',
          schema: z.object({ question: z.string() }),
        },
      );
      return [internalTool];
    };

    let toolsArr: ReturnType<typeof mkTools> | any[] = [];
    let systemPrompt: string;

    if (usedSearchMode === 'hybrid') {
      sideQueue.push({ type: 'status', phase: 'internal_kb', detail: 'start', tool: 'internal_kb_search' });
      const intRes = await this.smartQuery(retrievalQuery, 5, historyForKb);
      dedupeSource(intRes.sources || []);
      sideQueue.push({ type: 'status', phase: 'internal_kb', detail: 'done', tool: 'internal_kb_search' });

      sideQueue.push({ type: 'status', phase: 'ai_search', detail: 'start', tool: 'external_ai_search' });
      const extRes = await this.aiSearchWithOptionalSse(retrievalQuery, sideQueue);
      dedupeSource(extRes.sources || []);
      if (Array.isArray(extRes.followUps) && extRes.followUps.length > 0) {
        followUps.splice(0, followUps.length, ...extRes.followUps);
      }
      if (typeof extRes.confidence === 'number') confidence = extRes.confidence;
      if (!extRes.answer?.trim() && (!extRes.sources || extRes.sources.length === 0)) {
        this.logger.warn(
          '混合模式流式：外部 AI 搜索无有效答案与来源，请检查 AI_SEARCH_AGENT_URL、出网与 AISousuo 可用性',
        );
      }
      sideQueue.push({ type: 'status', phase: 'ai_search', detail: 'done', tool: 'external_ai_search' });

      const facts = this.formatHybridFactsForPrompt(intRes, extRes);
      toolsArr = [];
      const sandboxBlock =
        useSandbox && (requestExample?.trim() || sandboxLog)
          ? [
              '\n【请求示例与沙盒复现】',
              '客户请求示例（节选）:',
              (requestExample || '').trim().slice(0, 6000) || '（无）',
              '',
              '沙盒标准输出（节选）:',
              sandboxLog.slice(0, 8000) || '（无）',
              '',
              '请结合检索事实与沙盒输出做根因分析、排错步骤与安全提示；若沙盒失败说明可能原因。',
            ].join('\n')
          : '';
      systemPrompt = [
        '你是工单系统知识库助手。系统已自动完成「内部知识库」与「外部 AI 搜索」；下列【检索事实】为唯一依据，请综合回答用户，不得编造。',
        '输出中文：先给结论；区分内部要点与外部补充；若某一侧无有效内容要如实说明。',
        '不要原样复读长段 JSON。',
        '\n【检索事实】\n',
        facts,
        sandboxBlock,
      ].join('\n');
    } else {
      toolsArr = mkTools(sideQueue);
      systemPrompt = [
        '你是工单系统知识库助手，必须通过工具获取事实，不得编造。',
        `当前检索模式: ${usedSearchMode}`,
        useSandbox && (requestExample?.trim() || sandboxLog)
          ? [
              '当前已启用沙盒：用户粘贴了请求示例，且系统已在隔离环境中尝试执行；工具检索时请结合用户问题与下方【客户请求示例/沙盒输出】做接口/HTTP 排错。',
              '【客户请求示例（节选）】',
              (requestExample || '').trim().slice(0, 4000) || '（无）',
              '【沙盒输出（节选）】',
              sandboxLog.slice(0, 6000) || '（无）',
            ].join('\n')
          : '',
        '输出中文，结构清晰，先给结论，再给关键依据，最后可给下一步建议。',
        '不要原样复读工具JSON，要整理成可读答案。',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const userContent = [
      `历史对话（最近10轮）:\n${historyChat.map((h) => `${h.role}: ${h.content}`).join('\n') || '无'}`,
      `\n用户问题:\n${question}`,
      useSandbox && (requestExample?.trim() || sandboxLog)
        ? `\n\n---\n【客户请求示例】\n${(requestExample || '').trim() || '（无）'}\n\n【沙盒复现输出】\n${sandboxLog || '（无）'}\n`
        : '',
    ].join('');

    const runOneModel = async function* (
      this: KnowledgeBaseService,
      modelName: string,
      q: KbSideQueue,
    ): AsyncGenerator<KbStreamPayload> {
      const llm = this.createAgentModel(modelName, true);
      const agent = createAgent({ model: llm, tools: toolsArr, systemPrompt });
      let eventStream: AsyncIterable<any>;
      try {
        eventStream = await (agent as any).streamEvents(
          { messages: [{ role: 'user', content: userContent }] },
          { version: 'v2', recursionLimit: 50 },
        );
      } catch (e: any) {
        q.close();
        throw e;
      }
      const merged = mergeAgentStreamAndQueue(eventStream[Symbol.asyncIterator](), q);
      try {
        for await (const item of merged) {
          if (item.src === 'q') {
            yield item.p;
            continue;
          }
          const ev = item.ev;
          if (ev?.event === 'on_chat_model_stream') {
            const t = this.chunkToLlmText(ev.data?.chunk);
            if (t) yield { type: 'token', text: t, source: 'llm' };
          }
        }
      } catch (e: any) {
        q.close();
        throw e;
      }
    };

    try {
      yield* runOneModel.call(this, this.llmPrimaryModel, sideQueue);
    } catch (err: any) {
      const msg = String(err?.message || '');
      this.logger.warn(`主模型流式调用失败: ${msg}`);
      if (msg.includes('429') || msg.includes('RATE_LIMIT')) {
        const degraded = await this.smartQuery(retrievalQuery, 5, historyForKb);
        dedupeSource(degraded.sources || []);
        const text =
          degraded.answer ||
          '当前模型限流，已为你切换为内部知识库直答，请稍后再试 AI 增强模式。';
        yield { type: 'token', text, source: 'llm' };
      } else {
        const q2 = new KbSideQueue();
        try {
          yield* runOneModel.call(this, this.llmFallbackModel, q2);
        } catch (err2: any) {
          this.logger.error(`回退模型流式失败: ${err2?.message}`, err2?.stack);
          const degraded = await this.smartQuery(retrievalQuery, 5, historyForKb);
          dedupeSource(degraded.sources || []);
          yield { type: 'token', text: degraded.answer || '暂时无法生成回答，请稍后重试。', source: 'llm' };
        }
      }
    }

    yield {
      type: 'meta',
      sources: sourceBucket.slice(0, 10),
      followUps,
      confidence,
    };
  }

  async *chatStream(params: {
    sessionId?: string;
    userId: string;
    userRole: string;
    customerCode?: string;
    message: string;
    searchMode?: 'internal' | 'hybrid';
    useSandbox?: boolean;
    requestExample?: string;
  }): AsyncGenerator<KbStreamPayload> {
    const usedSearchMode: 'internal' | 'hybrid' = params.searchMode === 'hybrid' ? 'hybrid' : 'internal';
    let sessionId: string;
    try {
      sessionId = await this.getOrCreateSession(params);
    } catch (e: any) {
      yield { type: 'error', message: e?.message || '会话创建失败' };
      return;
    }
    const history = await this.getSessionMessages(sessionId, params.userId);
    await this.addMessage(sessionId, 'user', params.message, usedSearchMode);
    yield { type: 'session', sessionId, usedSearchMode };

    let assistantText = '';
    const sideQueue = new KbSideQueue();
    try {
      for await (const p of this.streamChatWithAgent({
        sessionId,
        userId: params.userId,
        question: params.message,
        history,
        usedSearchMode,
        sideQueue,
        useSandbox: params.useSandbox,
        requestExample: params.requestExample,
      })) {
        if (p.type === 'token' && p.source === 'llm') assistantText += p.text;
        if (p.type === 'meta') {
          yield p;
          continue;
        }
        yield p;
      }
    } catch (e: any) {
      sideQueue.close();
      yield { type: 'error', message: e?.message || '流式对话失败' };
      assistantText = assistantText || '对话中断，请重试。';
    } finally {
      sideQueue.close();
    }

    if (!assistantText.trim()) assistantText = '暂未检索到可用答案，请换个问法试试。';
    await this.addMessage(sessionId, 'assistant', assistantText, usedSearchMode);
    const messages = await this.getSessionMessages(sessionId, params.userId);
    yield { type: 'done', messages };
  }

  private async buildAgentAnswer(params: {
    sessionId: string;
    userId: string;
    question: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    searchMode: 'internal' | 'hybrid';
    useSandbox?: boolean;
    requestExample?: string;
  }) {
    const normalizeMessageContent = (content: any): string => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part?.text === 'string') return part.text;
            if (typeof part === 'object' && part !== null && 'type' in part) {
              const t = (part as { type?: string; text?: string }).type;
              const tx = (part as { text?: string }).text;
              if (t === 'text' && typeof tx === 'string') return tx;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
      return '';
    };

    const extractAgentAnswerText = (state: any): string => {
      const fromTop = normalizeMessageContent(state?.content);
      if (fromTop.trim()) return fromTop;
      const msgs = state?.messages;
      if (!Array.isArray(msgs)) return '';
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!AIMessage.isInstance(m)) continue;
        const text = normalizeMessageContent(m.content);
        if (text.trim()) return text;
      }
      return '';
    };

    const { sessionId, userId, question, history, searchMode, useSandbox, requestExample } = params;
    const historyForKb = [...history, { role: 'user' as const, content: question }].slice(-10);
    let sandboxLog = '';
    if (useSandbox && requestExample?.trim()) {
      const runStartedAt = new Date();
      let daytonaSandboxId: string | undefined;
      try {
        const run = await this.runSandboxRequestExample(requestExample.trim());
        sandboxLog = run.output;
        daytonaSandboxId = run.sandboxId;
      } catch (e: any) {
        sandboxLog = `【沙盒执行失败】${e?.message || String(e)}`;
        daytonaSandboxId = (e as Error & { sandboxId?: string })?.sandboxId;
        this.logger.warn(`Daytona (sync): ${e?.message}`);
      }
      try {
        await this.persistDaytonaAuditForSandbox({
          sessionId,
          userId,
          sandboxId: daytonaSandboxId,
          runStartedAt,
        });
      } catch (auditErr: any) {
        this.logger.warn(`Daytona audit 持久化跳过: ${auditErr?.message}`);
      }
    }
    const retrievalQuery = this.buildTriageRetrievalQuery(question, requestExample, sandboxLog);

    const sourceBucket: KBSearchResult[] = [];
    let followUps: string[] = [];
    let confidence: number | undefined;
    const sourceDedupeKey = (s: KBSearchResult) =>
      (s.url?.trim() || s.id || `${s.title}::${s.platform || ''}`).slice(0, 512);
    const dedupeSource = (items: KBSearchResult[]) => {
      const seen = new Set(sourceBucket.map(sourceDedupeKey));
      for (const item of items) {
        const key = sourceDedupeKey(item);
        if (!seen.has(key)) {
          seen.add(key);
          sourceBucket.push(item);
        }
      }
    };

    let tools: any[];
    let systemPrompt: string;

    if (searchMode === 'hybrid') {
      const noopQ = new KbSideQueue();
      const intRes = await this.smartQuery(retrievalQuery, 5, historyForKb);
      dedupeSource(intRes.sources || []);
      let extRes: { answer: string; sources: KBSearchResult[]; followUps: string[]; confidence?: number };
      try {
        extRes = await this.aiSearchWithOptionalSse(retrievalQuery, noopQ);
      } finally {
        noopQ.close();
      }
      dedupeSource(extRes.sources || []);
      if (Array.isArray(extRes.followUps) && extRes.followUps.length > 0) {
        followUps = extRes.followUps;
      }
      if (typeof extRes.confidence === 'number') {
        confidence = extRes.confidence;
      }
      if (!extRes.answer?.trim() && (!extRes.sources || extRes.sources.length === 0)) {
        this.logger.warn(
          '混合模式（同步）：外部 AI 搜索无有效答案与来源，请检查 AI_SEARCH_AGENT_URL 与出网',
        );
      }
      tools = [];
      const hybridSandbox =
        useSandbox && (requestExample?.trim() || sandboxLog)
          ? [
              '\n【请求示例与沙盒复现】',
              (requestExample || '').trim().slice(0, 6000) || '（无）',
              '',
              sandboxLog.slice(0, 8000) || '（无）',
            ].join('\n')
          : '';
      systemPrompt = [
        '你是工单系统知识库助手。系统已自动完成内部与外部检索；下列【检索事实】为唯一依据，请综合回答，不得编造。',
        '输出中文，先结论后依据；区分内部与外部补充；某一侧无内容要说明。',
        '不要原样复读长段 JSON。',
        '\n【检索事实】\n',
        this.formatHybridFactsForPrompt(intRes, extRes),
        hybridSandbox,
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      const internalTool = tool(
        async ({ question: q }: { question: string }) => {
          const res = await this.smartQuery(
            [q, retrievalQuery !== question ? `\n${retrievalQuery.slice(0, 2000)}` : ''].join('').trim(),
            5,
            historyForKb,
          );
          dedupeSource(res.sources || []);
          return JSON.stringify({
            answer: res.answer || '',
            sources: (res.sources || []).slice(0, 8),
          });
        },
        {
          name: 'internal_kb_search',
          description: '查询内部知识库并返回答案与来源文档',
          schema: z.object({
            question: z.string(),
          }),
        },
      );
      tools = [internalTool];
      systemPrompt = [
        '你是工单系统知识库助手，必须通过工具获取事实，不得编造。',
        `当前检索模式: ${searchMode}`,
        useSandbox && (requestExample?.trim() || sandboxLog)
          ? [
              '已启用沙盒：下列为客户请求示例与隔离环境执行输出，请结合工具检索做接口排错。',
              '【请求示例（节选）】',
              (requestExample || '').trim().slice(0, 4000) || '（无）',
              '【沙盒输出（节选）】',
              sandboxLog.slice(0, 6000) || '（无）',
            ].join('\n')
          : '',
        '输出中文，结构清晰，先给结论，再给关键依据，最后可给下一步建议。',
        '不要原样复读工具JSON，要整理成可读答案。',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const invokeAgentWithModel = async (modelName: string) => {
      const llm = this.createAgentModel(modelName);
      const agent = createAgent({
        model: llm,
        tools,
        systemPrompt,
      });
      return (agent as any).invoke(
        {
          messages: [
            {
              role: 'user',
              content: [
                `历史对话（最近10轮）:\n${history.map((h) => `${h.role}: ${h.content}`).join('\n') || '无'}`,
                `\n用户问题:\n${question}`,
                useSandbox && (requestExample?.trim() || sandboxLog)
                  ? `\n\n---\n【客户请求示例】\n${(requestExample || '').trim() || '（无）'}\n\n【沙盒复现输出】\n${sandboxLog || '（无）'}\n`
                  : '',
              ].join(''),
            },
          ],
        },
        { recursionLimit: 50 },
      );
    };

    let output: string;
    try {
      const res = await invokeAgentWithModel(this.llmPrimaryModel);
      output = extractAgentAnswerText(res);
    } catch (err: any) {
      this.logger.warn(`主模型调用失败，准备回退模型: ${err.message}`);
      const primaryErr = String(err?.message || '');
      if (primaryErr.includes('429') || primaryErr.includes('RATE_LIMIT')) {
        const degraded = await this.smartQuery(retrievalQuery, 5, historyForKb);
        dedupeSource(degraded.sources || []);
        output = degraded.answer || '';
        return {
          answer: output || '当前模型限流，已为你切换为内部知识库直答，请稍后再试 AI 增强模式。',
          sources: sourceBucket.slice(0, 10),
          followUps,
          confidence,
        };
      }
      try {
        const res = await invokeAgentWithModel(this.llmFallbackModel);
        output = extractAgentAnswerText(res);
      } catch (err2: any) {
        this.logger.error(`回退模型调用失败: ${err2?.message}`, err2?.stack);
        // 主备模型都失败时不要中断接口，降级为内部知识库直答，避免前端再次提问直接报错。
        const degraded = await this.smartQuery(retrievalQuery, 5, historyForKb);
        dedupeSource(degraded.sources || []);
        output = degraded.answer || '';
      }
    }

    return {
      answer: output || '暂未检索到可用答案，请换个问法试试。',
      sources: sourceBucket.slice(0, 10),
      followUps,
      confidence,
    };
  }

  async chat(params: {
    sessionId?: string;
    userId: string;
    userRole: string;
    customerCode?: string;
    message: string;
    searchMode?: 'internal' | 'hybrid';
    useSandbox?: boolean;
    requestExample?: string;
  }) {
    const usedSearchMode: 'internal' | 'hybrid' = params.searchMode === 'hybrid' ? 'hybrid' : 'internal';
    const sessionId = await this.getOrCreateSession(params);
    const history = await this.getSessionMessages(sessionId, params.userId);
    await this.addMessage(sessionId, 'user', params.message, usedSearchMode);

    const agentResult = await this.buildAgentAnswer({
      sessionId,
      userId: params.userId,
      question: params.message,
      history: history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
      searchMode: usedSearchMode,
      useSandbox: params.useSandbox,
      requestExample: params.requestExample,
    });
    const answer = agentResult.answer;

    await this.addMessage(sessionId, 'assistant', answer, usedSearchMode);
    const messages = await this.getSessionMessages(sessionId, params.userId);

    return {
      sessionId,
      answer,
      sources: agentResult.sources || [],
      followUps: agentResult.followUps || [],
      confidence: agentResult.confidence,
      usedSearchMode,
      messages,
    };
  }
}
