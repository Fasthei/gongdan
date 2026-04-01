import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { AzureChatOpenAI } from '@langchain/openai';
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

type AiSearchDepth = 'fast' | 'deep';
type DocOutputType = 'ppt' | 'word' | 'table';
type DocIntent = {
  outputType: DocOutputType;
  title?: string;
  format?: 'xlsx' | 'csv';
  numSlides?: number;
};

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly jinaMcpUrl: string;
  private readonly jinaApiKey: string;
  private readonly llmPrimaryModel: string;
  private readonly azureOpenAIEndpoint: string;
  private readonly azureOpenAIApiVersion: string;
  private readonly azureOpenAIDeployment: string;
  private readonly azureOpenAIApiKey: string;
  private readonly learnMcpUrl: string;
  private readonly learnMcpEnabled: boolean;
  private readonly learnMcpToolName: string;
  private sessionTableReady = false;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.baseUrl =
      this.config.get<string>('KB_AGENT_URL') ||
      'https://agnetdoc-cve0guf5h8eggmej.southeastasia-01.azurewebsites.net';
    this.apiKey = this.config.get<string>('KB_AGENT_API_KEY') || '';
    this.jinaMcpUrl = (this.config.get<string>('JINA_MCP_URL') || 'https://mcp.jina.ai/v1').replace(/\/$/, '');
    this.jinaApiKey = (this.config.get<string>('JINA_API_KEY') || '').trim();
    this.llmPrimaryModel = this.config.get<string>('LLM_PRIMARY_MODEL') || 'gpt-5.4';
    this.azureOpenAIEndpoint = this.config.get<string>('AZURE_OPENAI_ENDPOINT') || '';
    this.azureOpenAIApiVersion = this.config.get<string>('AZURE_OPENAI_API_VERSION') || '';
    this.azureOpenAIDeployment = this.config.get<string>('AZURE_OPENAI_API_DEPLOYMENT_NAME') || '';
    this.azureOpenAIApiKey = this.config.get<string>('AZURE_OPENAI_API_KEY') || '';
    this.learnMcpUrl = this.config.get<string>('LEARN_MCP_URL') || 'https://learn.microsoft.com/api/mcp';
    this.learnMcpEnabled = (this.config.get<string>('LEARN_MCP_ENABLED') || 'true').toLowerCase() !== 'false';
    this.learnMcpToolName = (this.config.get<string>('LEARN_MCP_TOOL_NAME') || '').trim();
  }

  private get headers() {
    return {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /** 展开嵌套 Error / axios 信息，便于判断 429、上下文过长等 */
  private flattenErrorText(err: any): string {
    const parts: string[] = [];
    let e: any = err;
    for (let depth = 0; e && depth < 6; depth++) {
      if (typeof e?.message === 'string' && e.message) parts.push(e.message);
      const status = e?.response?.status ?? e?.status;
      if (status != null) parts.push(`http_status=${status}`);
      const d = e?.response?.data;
      if (typeof d === 'string' && d.trim()) parts.push(d.slice(0, 2000));
      else if (d && typeof d === 'object') {
        try {
          parts.push(JSON.stringify(d).slice(0, 2000));
        } catch {
          /* ignore */
        }
      }
      e = e?.cause;
    }
    return parts.join(' | ');
  }

  /** 与 Azure/LangChain 常见的限流、TPM、上下文过长提示对齐（兼容 err.cause 链） */
  private isRateLimitOrPromptTooLargeError(err: any): boolean {
    const t = this.flattenErrorText(err).toLowerCase();
    return (
      /\b429\b/.test(t) ||
      /rate.?limit|too many requests|throttl/i.test(t) ||
      /too many tokens|token.?limit|tpm|tokens per min|maximum context|context.?length|maximum.?length|reduce the length/i.test(t)
    );
  }

  /** 多轮对话时截断单条消息，避免第二轮起把超长助手回复再次完整喂给主模型导致 TPM/上下文爆炸 */
  private shrinkDialogueForAgent(
    turns: Array<{ role: 'user' | 'assistant'; content: string }>,
    maxTurns = 8,
    maxCharsPerMessage = 3600,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return turns.slice(-maxTurns).map((x) => {
      const c = x.content || '';
      if (c.length <= maxCharsPerMessage) return { role: x.role, content: c };
      return {
        role: x.role,
        content: `${c.slice(0, maxCharsPerMessage)}\n…\n[本条消息过长，已截断以保障多轮对话可用]`,
      };
    });
  }

  private getSmartQueryTimeoutMs(): number {
    return Math.min(Math.max(Number(this.config.get<string>('KB_AGENT_SMART_QUERY_TIMEOUT_MS') || 30000) || 30000, 5000), 120000);
  }

  private getLlmTimeoutMs(): number {
    return Math.min(Math.max(Number(this.config.get<string>('LLM_TIMEOUT_MS') || 180000) || 180000, 15000), 600000);
  }

  private parseFirstJsonObject(raw: string): any | null {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();
    const codeFence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const target = (codeFence?.[1] || s).trim();
    const firstBrace = target.indexOf('{');
    const lastBrace = target.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(target.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  private inferDocIntentHeuristic(prompt: string): DocIntent {
    const p = prompt.toLowerCase();
    if (/(ppt|幻灯|演示|发布会|汇报|slides?)/i.test(p)) {
      return { outputType: 'ppt', numSlides: 8 };
    }
    if (/(excel|xlsx|csv|表格|台账|清单|明细表|数据表)/i.test(p)) {
      return { outputType: 'table', format: /csv/i.test(p) ? 'csv' : 'xlsx' };
    }
    return { outputType: 'word' };
  }

  /**
   * 子代理-1：意图识别（类型/标题/表格格式/页数）
   * 若 LLM 不可用则回退关键词规则；默认 word。
   */
  private async inferDocIntentSubagent(prompt: string): Promise<DocIntent> {
    const fallback = this.inferDocIntentHeuristic(prompt);
    if (!this.azureOpenAIApiKey?.trim()) return fallback;
    try {
      const llm = this.createAgentModel(this.llmPrimaryModel);
      const resp: any = await llm.invoke([
        {
          role: 'system',
          content:
            '你是 doc-intent 子代理。根据用户内容判断文档类型，仅输出 JSON：{"outputType":"word|ppt|table","title":"可选","format":"xlsx|csv(仅table)","numSlides":数字(仅ppt)}。若不明确默认 word。',
        },
        { role: 'user', content: prompt.slice(0, 12000) },
      ]);
      const text =
        typeof resp?.content === 'string'
          ? resp.content
          : Array.isArray(resp?.content)
            ? resp.content.map((x: any) => (typeof x?.text === 'string' ? x.text : '')).join('')
            : '';
      const j = this.parseFirstJsonObject(text);
      const t = String(j?.outputType || '').toLowerCase();
      const outputType: DocOutputType = t === 'ppt' || t === 'table' || t === 'word' ? (t as DocOutputType) : fallback.outputType;
      const title = typeof j?.title === 'string' && j.title.trim() ? j.title.trim().slice(0, 120) : undefined;
      const format: 'xlsx' | 'csv' | undefined =
        outputType === 'table' ? (String(j?.format || '').toLowerCase() === 'csv' ? 'csv' : 'xlsx') : undefined;
      const numSlides =
        outputType === 'ppt' && Number.isFinite(Number(j?.numSlides))
          ? Math.max(1, Math.min(50, Number(j.numSlides)))
          : fallback.numSlides;
      return { outputType, title, format, numSlides };
    } catch {
      return fallback;
    }
  }

  /**
   * 子代理-2：内容整理（让导出代理拿到更结构化的提示）
   */
  private async composeDocDraftSubagent(prompt: string, intent: DocIntent): Promise<string> {
    const target = intent.outputType === 'ppt' ? 'PPT' : intent.outputType === 'table' ? '表格' : 'Word 文档';
    return [
      `你将生成：${target}`,
      intent.title ? `建议标题：${intent.title}` : '',
      intent.outputType === 'table' && intent.format ? `表格格式：${intent.format}` : '',
      intent.outputType === 'ppt' && intent.numSlides ? `页数建议：${intent.numSlides}` : '',
      '',
      '请基于以下用户内容生成最终文档内容（保持专业、结构化、可直接导出）：',
      prompt,
    ]
      .filter(Boolean)
      .join('\n');
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
        { headers: this.headers, timeout: this.getSmartQueryTimeoutMs() },
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

  async generateDocument(params: {
    prompt: string;
    outputType?: DocOutputType;
    title?: string;
    format?: 'xlsx' | 'csv';
    numSlides?: number;
  }) {
    const base = (this.config.get<string>('DOC_CREATOR_BASE_URL') || 'http://doc-creator-agent-b0d02105-db4b3a.taijiagnet.com')
      .trim()
      .replace(/\/$/, '');
    const key = (this.config.get<string>('DOC_CREATOR_API_KEY') || '').trim();
    if (!key) {
      throw new Error('未配置 DOC_CREATOR_API_KEY，无法生成文档');
    }

    const explicitType = params.outputType;
    const normalizedType: DocOutputType = explicitType === 'ppt' || explicitType === 'table' ? explicitType : 'word';
    const headers = {
      'Content-Type': 'application/json',
      'api-key': key,
      Authorization: `Bearer ${key}`,
    };
    let data: any;

    // 协调器：未显式指定类型时，走子代理链路（意图识别 -> 草稿整理 -> 导出执行）。
    if (!explicitType) {
      const intent = await this.inferDocIntentSubagent(params.prompt);
      const docPrompt = await this.composeDocDraftSubagent(params.prompt, intent);
      const body: Record<string, any> = {
        prompt: docPrompt,
        output_type: intent.outputType || 'word',
      };
      if (intent.title || params.title) body.title = (params.title || intent.title)?.trim();
      if (intent.outputType === 'table') body.format = intent.format || params.format || 'xlsx';
      if (intent.outputType === 'ppt' && Number.isFinite(intent.numSlides)) body.num_slides = intent.numSlides;
      const genRes = await axios.post(`${base}/api/v1/generate`, body, {
        headers,
        timeout: 120000,
      });
      data = genRes.data;
    } else {
      const body: Record<string, any> = {
        prompt: params.prompt,
        output_type: normalizedType,
      };
      if (params.title) body.title = params.title;
      if (normalizedType === 'table' && params.format) body.format = params.format;
      if (normalizedType === 'ppt' && Number.isFinite(params.numSlides)) {
        body.num_slides = Math.max(1, Math.min(50, Number(params.numSlides)));
      }
      const genRes = await axios.post(`${base}/api/v1/generate`, body, {
        headers,
        timeout: 120000,
      });
      data = genRes.data;
    }

    const rawType = String(data?.output_type || '').toLowerCase();
    const finalType: DocOutputType =
      rawType === 'ppt' || rawType === 'table' || rawType === 'word' ? (rawType as DocOutputType) : normalizedType;

    const rawUrl = typeof data?.url === 'string' ? data.url.trim() : '';
    const absoluteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : rawUrl ? `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}` : '';

    return {
      success: !!data?.success,
      filename: data?.filename || '',
      outputType: finalType,
      url: absoluteUrl,
      format: data?.format || (finalType === 'table' ? params.format || 'xlsx' : undefined),
    };
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

  private getAiSearchDepth(depth?: AiSearchDepth): AiSearchDepth {
    if (depth === 'deep') return 'deep';
    return 'fast';
  }

  private buildJinaHeaders() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.jinaApiKey ? { Authorization: `Bearer ${this.jinaApiKey}` } : {}),
    };
  }

  private extractJinaMessage(raw: string): any | null {
    let last: any = null;
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const p = s.slice(5).trim();
      try {
        const j = JSON.parse(p);
        if (j?.jsonrpc === '2.0') last = j;
      } catch {
        /* ignore */
      }
    }
    return last;
  }

  private async callJinaMcp(method: string, params: Record<string, any>) {
    const payload = { jsonrpc: '2.0', id: randomUUID(), method, params };
    const { data } = await axios.post(this.jinaMcpUrl, payload, {
      timeout: 30000,
      responseType: 'text',
      headers: this.buildJinaHeaders(),
    });
    const msg = this.extractJinaMessage(typeof data === 'string' ? data : String(data ?? ''));
    if (!msg) throw new Error('Jina MCP 响应为空');
    if (msg.error) throw new Error(`Jina MCP ${method} 失败: ${msg.error?.message || 'unknown error'}`);
    return msg.result;
  }

  private extractJinaToolText(result: any): string {
    const parts = Array.isArray(result?.content) ? result.content : [];
    return parts
      .map((p: any) => (p?.type === 'text' && typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private extractSourcesFromMarkdown(text: string): KBSearchResult[] {
    const out: KBSearchResult[] = [];
    const seen = new Set<string>();
    const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdRe.exec(text)) !== null) {
      const url = m[2];
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ id: String(out.length), title: m[1] || 'Web', content: '', score: 1, url });
      if (out.length >= 24) return out;
    }
    const urlRe = /\bhttps?:\/\/[^\s\])"'<>]+/g;
    let u: RegExpExecArray | null;
    while ((u = urlRe.exec(text)) !== null) {
      const url = u[0].replace(/[.,;:)]+$/g, '');
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ id: String(out.length), title: 'Web', content: '', score: 0.5, url });
      if (out.length >= 24) break;
    }
    return out;
  }

  private async jinaToolCall(name: string, args: Record<string, any>) {
    const res = await this.callJinaMcp('tools/call', { name, arguments: args });
    const text = this.extractJinaToolText(res);
    return { text, raw: res };
  }

  private parseExpandedQueries(text: string, fallback: string): string[] {
    const t = text.trim();
    if (!t) return [fallback];
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j)) {
        const qs: string[] = j.map((x) => String(x).trim()).filter(Boolean);
        if (qs.length) return [...new Set(qs)].slice(0, 5);
      }
      if (j?.queries && Array.isArray(j.queries)) {
        const qs: string[] = j.queries.map((x: any) => String(x).trim()).filter(Boolean);
        if (qs.length) return [...new Set(qs)].slice(0, 5);
      }
    } catch {
      /* non-json text */
    }
    const qs = t
      .split('\n')
      .map((x) => x.replace(/^\s*[\d\-\*\.)]+\s*/, '').trim())
      .filter((x) => x.length > 3 && !/^error:/i.test(x));
    return qs.length ? [...new Set(qs)].slice(0, 5) : [fallback];
  }

  async aiSearch(query: string, depth?: AiSearchDepth) {
    const d = this.getAiSearchDepth(depth);
    if (!this.jinaApiKey) {
      this.logger.warn(`AI 搜索调用失败(${d}): 缺少 JINA_API_KEY`);
      return { answer: '', sources: [], followUps: [], confidence: undefined };
    }
    try {
      if (d === 'fast') {
        const num = Math.max(1, Math.min(20, Number(this.config.get<string>('JINA_SEARCH_NUM_FAST') || 8)));
        const { text } = await this.jinaToolCall('search_web', { query, num, hl: 'zh-cn' });
        return { answer: text, sources: this.extractSourcesFromMarkdown(text), followUps: [], confidence: undefined };
      }
      const expanded = await this.jinaToolCall('expand_query', { query });
      const expandedQueries = this.parseExpandedQueries(expanded.text, query);
      const searches = expandedQueries.slice(0, 5).map((q) => ({
        query: q,
        num: Math.max(3, Math.min(20, Number(this.config.get<string>('JINA_SEARCH_NUM_DEEP') || 10))),
        hl: 'zh-cn',
      }));
      const parallel = await this.jinaToolCall('parallel_search_web', {
        searches,
        timeout: Math.max(10000, Math.min(90000, Number(this.config.get<string>('JINA_PARALLEL_TIMEOUT_MS') || 30000))),
      });
      return {
        answer: parallel.text || expanded.text,
        sources: this.extractSourcesFromMarkdown(parallel.text || expanded.text),
        followUps: [],
        confidence: undefined,
      };
    } catch (err: any) {
      this.logger.warn(`AI 搜索调用失败(${d}): ${err.message}`);
      return { answer: '', sources: [], followUps: [], confidence: undefined };
    }
  }

  private createAgentModel(modelName: string, streaming = false) {
    if (!this.azureOpenAIEndpoint?.trim()) {
      throw new Error('缺少 AZURE_OPENAI_ENDPOINT（标准 Azure OpenAI 必填）');
    }
    if (!this.azureOpenAIApiVersion?.trim()) {
      throw new Error('缺少 AZURE_OPENAI_API_VERSION（标准 Azure OpenAI 必填）');
    }
    if (!this.azureOpenAIDeployment?.trim()) {
      throw new Error('缺少 AZURE_OPENAI_API_DEPLOYMENT_NAME（标准 Azure OpenAI 必填）');
    }
    if (!this.azureOpenAIApiKey?.trim()) {
      throw new Error('缺少 AZURE_OPENAI_API_KEY（标准 Azure OpenAI 必填）');
    }
    return new AzureChatOpenAI({
      azureOpenAIEndpoint: this.azureOpenAIEndpoint,
      azureOpenAIApiKey: this.azureOpenAIApiKey,
      azureOpenAIApiVersion: this.azureOpenAIApiVersion,
      azureOpenAIApiDeploymentName: this.azureOpenAIDeployment,
      model: modelName,
      temperature: 0.2,
      timeout: this.getLlmTimeoutMs(),
      maxRetries: 0,
      streaming,
    });
  }

  private async callLearnMcp(method: string, params: Record<string, any>) {
    const payload = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    };
    const { data } = await axios.post(this.learnMcpUrl, payload, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    });
    return data;
  }

  private pickLearnSearchTool(tools: any[]): any | null {
    if (!Array.isArray(tools) || tools.length === 0) return null;
    if (this.learnMcpToolName) {
      const exact = tools.find((t) => String(t?.name || '') === this.learnMcpToolName);
      if (exact) return exact;
    }
    const scored = tools
      .map((t) => {
        const name = String(t?.name || '').toLowerCase();
        let s = 0;
        if (name.includes('search')) s += 3;
        if (name.includes('learn')) s += 2;
        if (name.includes('doc')) s += 2;
        if (name.includes('article')) s += 1;
        return { t, s };
      })
      .sort((a, b) => b.s - a.s);
    return scored[0]?.s > 0 ? scored[0].t : tools[0];
  }

  private buildLearnToolArgs(schema: any, query: string): Record<string, any> {
    const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const keys = Object.keys(props);
    const preferred = keys.find((k) => /(query|q|question|keyword|search|text)/i.test(k)) || keys[0];
    if (!preferred) return { query };
    return { [preferred]: query };
  }

  private async learnMcpSearch(query: string): Promise<string> {
    if (!this.learnMcpEnabled) return JSON.stringify({ disabled: true });
    try {
      const listed = await this.callLearnMcp('tools/list', {});
      const tools = listed?.result?.tools || listed?.tools || [];
      const selected = this.pickLearnSearchTool(tools);
      if (!selected?.name) {
        return JSON.stringify({ error: 'learn mcp tools/list returned no callable tool' });
      }
      const args = this.buildLearnToolArgs(selected?.inputSchema, query);
      const called = await this.callLearnMcp('tools/call', {
        name: selected.name,
        arguments: args,
      });
      const out = called?.result ?? called;
      const text = JSON.stringify(
        {
          tool: selected.name,
          arguments: args,
          result: out,
        },
        null,
        2,
      );
      return text.length > 12000 ? `${text.slice(0, 12000)}\n... [truncated]` : text;
    } catch (e: any) {
      this.logger.warn(`Learn MCP tool failed: ${e?.message}`);
      return JSON.stringify({ error: e?.message || 'learn mcp call failed' });
    }
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
   * 从 Chat 模型流式 chunk 中提取「推理 / 思考」增量（OpenAI Responses reasoning、Ollama reasoning_content、通用 reasoning 块等）。
   * 与 {@link chunkToLlmText} 分离，避免把 CoT 混进对用户展示的正文。
   */
  private chunkToLlmReasoningDelta(chunk: any): string {
    if (!chunk) return '';
    const c = chunk.content;
    if (Array.isArray(c)) {
      const fromBlocks = c
        .map((part: any) => {
          if (!part || typeof part !== 'object') return '';
          const t = part.type;
          if (t === 'reasoning') {
            if (typeof part.reasoning === 'string') return part.reasoning;
            if (typeof part.text === 'string') return part.text;
          }
          if (t === 'thinking' && typeof part.thinking === 'string') return part.thinking;
          if (t === 'redacted_thinking') return '[推理内容已脱敏]\n';
          return '';
        })
        .join('');
      if (fromBlocks.trim()) return fromBlocks;
    }
    const ak = chunk.additional_kwargs;
    if (ak && typeof ak === 'object') {
      if (typeof (ak as any).reasoning_content === 'string' && (ak as any).reasoning_content) {
        return String((ak as any).reasoning_content);
      }
      const r = (ak as any).reasoning;
      if (r && typeof r === 'object' && Array.isArray(r.summary)) {
        const fromSummary = r.summary
          .map((s: any) => (typeof s?.text === 'string' ? s.text : ''))
          .join('');
        if (fromSummary.trim()) return fromSummary;
      }
    }
    return '';
  }

  /** Agent 工具调用步骤，作为可读的 CoT 补充（与模型原生 reasoning 无关时仍有助于排查） */
  private formatAgentToolThinkLine(ev: any): string {
    const name = typeof ev?.name === 'string' ? ev.name.trim() : '';
    if (!name) return '';
    const input = ev?.data?.input;
    let extra = '';
    try {
      if (input && typeof input === 'object') {
        const q = (input as any).question;
        if (typeof q === 'string' && q.trim()) extra = q.trim().slice(0, 400);
        else extra = JSON.stringify(input).slice(0, 400);
      }
    } catch {
      /* ignore */
    }
    return `\n▸ 工具 ${name}${extra ? `：${extra}` : ''}\n`;
  }

  private async aiSearchWithOptionalSse(query: string, sideQueue: KbSideQueue, depth?: AiSearchDepth) {
    const d = this.getAiSearchDepth(depth);
    sideQueue.push({ type: 'status', phase: 'jina_initialize', detail: 'start', tool: 'jina_mcp' });
    try {
      await this.callJinaMcp('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'gongdan-ticket-system', version: '1.0' },
      });
      sideQueue.push({ type: 'status', phase: 'jina_initialize', detail: 'done', tool: 'jina_mcp' });
    } catch (e: any) {
      sideQueue.push({ type: 'status', phase: 'jina_initialize', detail: `error:${e?.message || 'init failed'}`, tool: 'jina_mcp' });
      return this.aiSearch(query, d);
    }

    if (d === 'fast') {
      sideQueue.push({ type: 'llm_think', text: '\n▸ 外部检索（Fast）：单轮 Web 搜索，优先时延。\n' });
      sideQueue.push({ type: 'status', phase: 'jina_fast_search', detail: 'start', tool: 'search_web' });
      const res = await this.aiSearch(query, 'fast');
      sideQueue.push({ type: 'status', phase: 'jina_fast_search', detail: 'done', tool: 'search_web' });
      return res;
    }

    sideQueue.push({ type: 'llm_think', text: '\n▸ 外部检索（Deep）：查询扩展 -> 并行搜索 -> 深度重排。\n' });
    sideQueue.push({ type: 'status', phase: 'deep_expand_query', detail: 'start', tool: 'expand_query' });
    let expandedQueries: string[] = [query];
    try {
      const ex = await this.jinaToolCall('expand_query', { query });
      expandedQueries = this.parseExpandedQueries(ex.text, query);
      sideQueue.push({ type: 'llm_think', text: `\n▸ Deep 扩展子查询：${expandedQueries.slice(0, 5).join('；')}\n` });
    } finally {
      sideQueue.push({ type: 'status', phase: 'deep_expand_query', detail: 'done', tool: 'expand_query' });
    }

    sideQueue.push({ type: 'status', phase: 'deep_parallel_search', detail: 'start', tool: 'parallel_search_web' });
    let deepText = '';
    try {
      const searches = expandedQueries.slice(0, 5).map((q) => ({
        query: q,
        num: Math.max(3, Math.min(20, Number(this.config.get<string>('JINA_SEARCH_NUM_DEEP') || 10))),
        hl: 'zh-cn',
      }));
      const ps = await this.jinaToolCall('parallel_search_web', {
        searches,
        timeout: Math.max(10000, Math.min(90000, Number(this.config.get<string>('JINA_PARALLEL_TIMEOUT_MS') || 30000))),
      });
      deepText = ps.text;
    } finally {
      sideQueue.push({ type: 'status', phase: 'deep_parallel_search', detail: 'done', tool: 'parallel_search_web' });
    }
    return { answer: deepText, sources: this.extractSourcesFromMarkdown(deepText), followUps: [], confidence: undefined };
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

  /** 合并用户描述、请求示例、沙盒输出与临时文档上下文（文档不入库），供知识库/外部检索 */
  private buildTriageRetrievalQuery(
    question: string,
    requestExample: string | undefined,
    sandboxLog: string,
    docContext?: string,
    docName?: string,
  ): string {
    if (!requestExample?.trim() && !sandboxLog.trim() && !docContext?.trim()) return question;
    return [
      question,
      '--- 客户请求示例（节选） ---',
      (requestExample || '').trim().slice(0, 4000),
      '--- 沙盒执行输出（节选） ---',
      sandboxLog.trim().slice(0, 6000),
      docContext?.trim() ? `--- 临时文档上下文（${docName?.trim() || '未命名文档'}，节选） ---` : '',
      (docContext || '').trim().slice(0, 8000),
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

  private mergeSourcesByRatio(internal: KBSearchResult[], external: KBSearchResult[], internalRatio = 0.55, maxTotal = 16) {
    const iTarget = Math.max(1, Math.round(maxTotal * internalRatio));
    const eTarget = Math.max(1, maxTotal - iTarget);
    const picked = [...(internal || []).slice(0, iTarget), ...(external || []).slice(0, eTarget)];
    const seen = new Set<string>();
    const out: KBSearchResult[] = [];
    for (const s of picked) {
      const key = (s.url || `${s.title}::${s.content}`).slice(0, 400);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= maxTotal) break;
    }
    return out;
  }

  private async rerankForDeep(query: string, sources: KBSearchResult[], sideQueue?: KbSideQueue): Promise<KBSearchResult[]> {
    if (!sources.length) return [];
    sideQueue?.push({ type: 'status', phase: 'deep_rerank', detail: 'start', tool: 'sort_by_relevance' });
    try {
      const documents = sources.map((s) => ({
        text: [s.title, s.content, s.url].filter(Boolean).join('\n'),
        metadata: { id: s.id, title: s.title, url: s.url },
      }));
      const { text } = await this.jinaToolCall('sort_by_relevance', {
        query,
        documents,
        top_n: Math.min(12, documents.length),
      });
      const urlsInOrder: string[] = [];
      const mdRe = /\((https?:\/\/[^)\s]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = mdRe.exec(text)) !== null) urlsInOrder.push(m[1]);
      if (!urlsInOrder.length) return sources;
      const rankMap = new Map<string, number>();
      urlsInOrder.forEach((u, i) => rankMap.set(u, i));
      return [...sources].sort((a, b) => {
        const ar = rankMap.get(a.url || '') ?? 10_000;
        const br = rankMap.get(b.url || '') ?? 10_000;
        return ar - br;
      });
    } catch (e: any) {
      this.logger.warn(`Deep rerank 失败，沿用原排序: ${e?.message || e}`);
      return sources;
    } finally {
      sideQueue?.push({ type: 'status', phase: 'deep_rerank', detail: 'done', tool: 'sort_by_relevance' });
    }
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
    aiSearchDepth?: AiSearchDepth;
    docContext?: string;
    docName?: string;
  }): AsyncGenerator<KbStreamPayload> {
    const { sessionId, userId, question, history, usedSearchMode, sideQueue, useSandbox, requestExample, aiSearchDepth, docContext, docName } =
      params;
    const historyRaw = history.slice(-10).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));
    const historyChat = this.shrinkDialogueForAgent(historyRaw);
    const historyForKb = [...this.shrinkDialogueForAgent(historyRaw), { role: 'user' as const, content: question }].slice(-10);

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
    const retrievalQuery = this.buildTriageRetrievalQuery(question, requestExample, sandboxLog, docContext, docName);

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
      const learnMcpTool = tool(
        async ({ question: qtext }: { question: string }) => {
          q.push({ type: 'status', phase: 'learn_mcp', detail: 'start', tool: 'learn_mcp_search' });
          const res = await this.learnMcpSearch(qtext);
          q.push({ type: 'status', phase: 'learn_mcp', detail: 'done', tool: 'learn_mcp_search' });
          return res;
        },
        {
          name: 'learn_mcp_search',
          description:
            '查询 Microsoft Learn MCP（官方文档），返回与问题相关的最新文档片段与链接；适合 Azure/.NET/Microsoft 技术问题。',
          schema: z.object({ question: z.string() }),
        },
      );
      return [internalTool, learnMcpTool];
    };

    let toolsArr: ReturnType<typeof mkTools> | any[] = [];
    let systemPrompt: string;

    if (usedSearchMode === 'hybrid') {
      sideQueue.push({ type: 'status', phase: 'internal_kb', detail: 'start', tool: 'internal_kb_search' });
      const intRes = await this.smartQuery(retrievalQuery, 5, historyForKb);
      sideQueue.push({ type: 'status', phase: 'internal_kb', detail: 'done', tool: 'internal_kb_search' });

      sideQueue.push({ type: 'status', phase: 'ai_search', detail: 'start', tool: 'external_ai_search' });
      const extRes = await this.aiSearchWithOptionalSse(retrievalQuery, sideQueue, aiSearchDepth);
      if (Array.isArray(extRes.followUps) && extRes.followUps.length > 0) {
        followUps.splice(0, followUps.length, ...extRes.followUps);
      }
      if (typeof extRes.confidence === 'number') confidence = extRes.confidence;
      if (!extRes.answer?.trim() && (!extRes.sources || extRes.sources.length === 0)) {
        this.logger.warn(
          '混合模式流式：外部 AI 搜索无有效答案与来源，请检查 JINA_API_KEY、出网与 Jina MCP 可用性',
        );
      }
      sideQueue.push({ type: 'status', phase: 'ai_search', detail: 'done', tool: 'external_ai_search' });
      const mergedSources = this.mergeSourcesByRatio(intRes.sources || [], extRes.sources || [], 0.55, 16);
      const finalSources = this.getAiSearchDepth(aiSearchDepth) === 'deep'
        ? await this.rerankForDeep(retrievalQuery, mergedSources, sideQueue)
        : mergedSources;
      dedupeSource(finalSources);
      sideQueue.push({
        type: 'llm_think',
        text: `\n▸ 混合检索融合：内部 ${(intRes.sources || []).length} 条，外部 ${(extRes.sources || []).length} 条，按 55/45 融合后 ${finalSources.length} 条${this.getAiSearchDepth(aiSearchDepth) === 'deep' ? '，并执行深度重排' : ''}。\n`,
      });

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
      docContext?.trim()
        ? `\n\n---\n【临时文档上下文（本轮，仅供推理）】\n文档: ${docName?.trim() || '未命名文档'}\n${docContext.trim().slice(0, 10000)}\n`
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
            const ch = ev.data?.chunk;
            const think = this.chunkToLlmReasoningDelta(ch);
            if (think) yield { type: 'llm_think', text: think };
            const t = this.chunkToLlmText(ch);
            if (t) yield { type: 'token', text: t, source: 'llm' };
          } else if (ev?.event === 'on_tool_start') {
            const line = this.formatAgentToolThinkLine(ev);
            if (line) yield { type: 'llm_think', text: line };
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
      const detail = this.flattenErrorText(err);
      this.logger.warn(`主模型流式调用失败: ${detail.slice(0, 1500)}`);
      const degraded = await this.smartQuery(retrievalQuery, 5, historyForKb);
      dedupeSource(degraded.sources || []);
      if (this.isRateLimitOrPromptTooLargeError(err)) {
        const text =
          degraded.answer ||
          '当前模型触发限流或上下文体量过大（多轮长对话易发）。已改为仅依据内部知识库与本轮检索要点回复；你可新建会话或拆成更短问题再试。';
        yield { type: 'token', text, source: 'llm' };
      } else {
        yield {
          type: 'token',
          text:
            degraded.answer ||
            `主模型暂时不可用（${detail.slice(0, 280) || '未知错误'}）。已尽量用内部知识库作答；请稍后重试或缩短对话上下文。`,
          source: 'llm',
        };
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
    aiSearchDepth?: AiSearchDepth;
    useSandbox?: boolean;
    requestExample?: string;
    docContext?: string;
    docName?: string;
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
        aiSearchDepth: params.aiSearchDepth,
        sideQueue,
        useSandbox: params.useSandbox,
        requestExample: params.requestExample,
        docContext: params.docContext,
        docName: params.docName,
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
    aiSearchDepth?: AiSearchDepth;
    useSandbox?: boolean;
    requestExample?: string;
    docContext?: string;
    docName?: string;
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

    const { sessionId, userId, question, history, searchMode, aiSearchDepth, useSandbox, requestExample, docContext, docName } = params;
    const historyRaw = history.slice(-10).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));
    const historySlim = this.shrinkDialogueForAgent(historyRaw);
    const historyForKb = [...historySlim, { role: 'user' as const, content: question }].slice(-10);
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
    const retrievalQuery = this.buildTriageRetrievalQuery(question, requestExample, sandboxLog, docContext, docName);

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
      let extRes: { answer: string; sources: KBSearchResult[]; followUps: string[]; confidence?: number };
      try {
        extRes = await this.aiSearchWithOptionalSse(retrievalQuery, noopQ, aiSearchDepth);
      } finally {
        noopQ.close();
      }
      const mergedSources = this.mergeSourcesByRatio(intRes.sources || [], extRes.sources || [], 0.55, 16);
      const finalSources = this.getAiSearchDepth(aiSearchDepth) === 'deep'
        ? await this.rerankForDeep(retrievalQuery, mergedSources)
        : mergedSources;
      dedupeSource(finalSources);
      if (Array.isArray(extRes.followUps) && extRes.followUps.length > 0) {
        followUps = extRes.followUps;
      }
      if (typeof extRes.confidence === 'number') {
        confidence = extRes.confidence;
      }
      if (!extRes.answer?.trim() && (!extRes.sources || extRes.sources.length === 0)) {
        this.logger.warn(
          '混合模式（同步）：外部 AI 搜索无有效答案与来源，请检查 JINA_API_KEY、出网与 Jina MCP 可用性',
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
      const learnMcpTool = tool(
        async ({ question: q }: { question: string }) => {
          return this.learnMcpSearch(q);
        },
        {
          name: 'learn_mcp_search',
          description:
            '查询 Microsoft Learn MCP（官方文档），返回与问题相关的最新文档片段与链接；适合 Azure/.NET/Microsoft 技术问题。',
          schema: z.object({
            question: z.string(),
          }),
        },
      );
      tools = [internalTool, learnMcpTool];
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
                `历史对话（最近若干轮，已截断过长消息）:\n${
                  historySlim.map((h) => `${h.role}: ${h.content}`).join('\n') || '无'
                }`,
                `\n用户问题:\n${question}`,
                useSandbox && (requestExample?.trim() || sandboxLog)
                  ? `\n\n---\n【客户请求示例】\n${(requestExample || '').trim() || '（无）'}\n\n【沙盒复现输出】\n${sandboxLog || '（无）'}\n`
                  : '',
                docContext?.trim()
                  ? `\n\n---\n【临时文档上下文（本轮，仅供推理）】\n文档: ${docName?.trim() || '未命名文档'}\n${docContext.trim().slice(0, 10000)}\n`
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
      const detail = this.flattenErrorText(err);
      this.logger.warn(`主模型调用失败: ${detail.slice(0, 1500)}`);
      const degraded = await this.smartQuery(retrievalQuery, 5, historyForKb);
      dedupeSource(degraded.sources || []);
      if (this.isRateLimitOrPromptTooLargeError(err)) {
        output = degraded.answer || '';
        return {
          answer:
            output ||
            '当前模型触发限流或上下文体量过大（多轮长对话易发）。已改为依据内部知识库与本轮检索要点回复；建议新建会话或缩短问题。',
          sources: sourceBucket.slice(0, 10),
          followUps,
          confidence,
        };
      }
      output = degraded.answer || '';
    }

    return {
      answer: output || '暂未检索到可用答案，请换个问法试试。',
      sources: sourceBucket.slice(0, 10),
      followUps,
      confidence,
    };
  }


  async deleteSession(sessionId: string, userId: string) {
    const sid = sessionId?.trim();
    if (!sid) {
      throw new NotFoundException('会话不存在或无权删除');
    }
    await this.ensureSessionTables();
    const own = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM kb_chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      sid,
      String(userId),
    );
    if (own.length === 0) {
      throw new NotFoundException('会话不存在或无权删除');
    }
    try {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM kb_sandbox_audit_events WHERE session_id = $1`,
        sid,
      );
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM kb_chat_messages WHERE session_id = $1`,
        sid,
      );
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM kb_chat_sessions WHERE id = $1`,
        sid,
      );
    } catch (e: any) {
      this.logger.error(`deleteSession DB error: ${e?.message || e}`);
      throw e;
    }
    return { success: true };
  }
}
