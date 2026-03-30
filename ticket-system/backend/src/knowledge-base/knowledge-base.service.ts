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

      return raw.map((item: any) => ({
        id: item.id || '',
        title: item.title || '',
        content: item.content || item.text || '',
        platform: item.source || item.platform || '',
        score: item['@search.score'] || item.score || 0,
      }));
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

      const sources: KBSearchResult[] = (data.sources || data.results || []).map((item: any) => ({
        id: item.id || '',
        title: item.title || '',
        content: item.content || item.text || '',
        platform: item.source || item.platform || '',
        score: item.score || 0,
      }));

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
    return refs.map((item: any, idx: number) => ({
      id: item.id || `${idx}`,
      title: item.title || item.name || item.url || 'AI Search Source',
      content: item.snippet || item.content || item.text || '',
      platform: item.domain || item.source || '',
      score: Number(item.score || item.confidence || 0),
    }));
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
        ? citations.map((c: any, idx: number) => ({
            id: String(c.id ?? c.url ?? idx),
            title: c.title || c.name || c.url || '引用',
            content: c.snippet || c.text || c.content || '',
            platform: c.domain || c.source || '',
            score: Number(c.trust_score ?? c.score ?? 0),
          }))
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
    question: string;
    history: KBChatMessage[];
    usedSearchMode: 'internal' | 'hybrid';
    sideQueue: KbSideQueue;
  }): AsyncGenerator<KbStreamPayload> {
    const { question, history, usedSearchMode, sideQueue } = params;
    const historyChat = history.slice(-10).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));
    const historyForKb = [...historyChat, { role: 'user' as const, content: question }].slice(-10);

    const sourceBucket: KBSearchResult[] = [];
    let followUps: string[] = [];
    let confidence: number | undefined;
    const dedupeSource = (items: KBSearchResult[]) => {
      const seen = new Set(sourceBucket.map((s) => `${s.title}::${s.platform || ''}`));
      for (const item of items) {
        const key = `${item.title}::${item.platform || ''}`;
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
          const res = await this.smartQuery(qtext, 5, historyForKb);
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
      const intRes = await this.smartQuery(question, 5, historyForKb);
      dedupeSource(intRes.sources || []);
      sideQueue.push({ type: 'status', phase: 'internal_kb', detail: 'done', tool: 'internal_kb_search' });

      sideQueue.push({ type: 'status', phase: 'ai_search', detail: 'start', tool: 'external_ai_search' });
      const extRes = await this.aiSearchWithOptionalSse(question, sideQueue);
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
      systemPrompt = [
        '你是工单系统知识库助手。系统已自动完成「内部知识库」与「外部 AI 搜索」；下列【检索事实】为唯一依据，请综合回答用户，不得编造。',
        '输出中文：先给结论；区分内部要点与外部补充；若某一侧无有效内容要如实说明。',
        '不要原样复读长段 JSON。',
        '\n【检索事实】\n',
        facts,
      ].join('\n');
    } else {
      toolsArr = mkTools(sideQueue);
      systemPrompt = [
        '你是工单系统知识库助手，必须通过工具获取事实，不得编造。',
        `当前检索模式: ${usedSearchMode}`,
        '输出中文，结构清晰，先给结论，再给关键依据，最后可给下一步建议。',
        '不要原样复读工具JSON，要整理成可读答案。',
      ].join('\n');
    }

    const userContent = [
      `历史对话（最近10轮）:\n${historyChat.map((h) => `${h.role}: ${h.content}`).join('\n') || '无'}`,
      `\n用户问题:\n${question}`,
    ].join('\n');

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
        const degraded = await this.smartQuery(question, 5, historyForKb);
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
          const degraded = await this.smartQuery(question, 5, historyForKb);
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
        question: params.message,
        history,
        usedSearchMode,
        sideQueue,
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
    question: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    searchMode: 'internal' | 'hybrid';
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

    const { question, history, searchMode } = params;
    const historyForKb = [...history, { role: 'user' as const, content: question }].slice(-10);
    const sourceBucket: KBSearchResult[] = [];
    let followUps: string[] = [];
    let confidence: number | undefined;
    const dedupeSource = (items: KBSearchResult[]) => {
      const seen = new Set(sourceBucket.map((s) => `${s.title}::${s.platform || ''}`));
      for (const item of items) {
        const key = `${item.title}::${item.platform || ''}`;
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
      const intRes = await this.smartQuery(question, 5, historyForKb);
      dedupeSource(intRes.sources || []);
      let extRes: { answer: string; sources: KBSearchResult[]; followUps: string[]; confidence?: number };
      try {
        extRes = await this.aiSearchWithOptionalSse(question, noopQ);
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
      systemPrompt = [
        '你是工单系统知识库助手。系统已自动完成内部与外部检索；下列【检索事实】为唯一依据，请综合回答，不得编造。',
        '输出中文，先结论后依据；区分内部与外部补充；某一侧无内容要说明。',
        '不要原样复读长段 JSON。',
        '\n【检索事实】\n',
        this.formatHybridFactsForPrompt(intRes, extRes),
      ].join('\n');
    } else {
      const internalTool = tool(
        async ({ question: q }: { question: string }) => {
          const res = await this.smartQuery(q, 5, historyForKb);
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
        '输出中文，结构清晰，先给结论，再给关键依据，最后可给下一步建议。',
        '不要原样复读工具JSON，要整理成可读答案。',
      ].join('\n');
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
              ].join('\n'),
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
        const degraded = await this.smartQuery(question, 5, historyForKb);
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
        const degraded = await this.smartQuery(question, 5, historyForKb);
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
  }) {
    const usedSearchMode: 'internal' | 'hybrid' = params.searchMode === 'hybrid' ? 'hybrid' : 'internal';
    const sessionId = await this.getOrCreateSession(params);
    const history = await this.getSessionMessages(sessionId, params.userId);
    await this.addMessage(sessionId, 'user', params.message, usedSearchMode);

    const agentResult = await this.buildAgentAnswer({
      question: params.message,
      history: history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
      searchMode: usedSearchMode,
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
