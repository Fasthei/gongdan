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
        { headers: this.headers, timeout: 15000 },
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

  async aiSearch(query: string) {
    try {
      const { data } = await axios.post(
        `${this.aiSearchBaseUrl}/search`,
        { query },
        { timeout: 20000 },
      );
      return {
        answer: data?.answer || data?.summary || '',
        sources: this.normalizeAiSearchSources(data),
        followUps: Array.isArray(data?.follow_ups) ? data.follow_ups : [],
        confidence: typeof data?.confidence === 'number' ? data.confidence : undefined,
      };
    } catch (err: any) {
      this.logger.warn(`AI 搜索调用失败: ${err.message}`);
      return { answer: '', sources: [], followUps: [], confidence: undefined };
    }
  }

  private createAgentModel(modelName: string) {
    return new ChatOpenAI({
      model: modelName,
      apiKey: this.llmApiKey,
      configuration: {
        baseURL: this.llmBaseUrl,
      },
      temperature: 0.2,
      timeout: 30000,
    });
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

    const externalTool = tool(
      async ({ query }: { query: string }) => {
        if (searchMode !== 'hybrid') {
          return JSON.stringify({
            disabled: true,
            reason: 'external search disabled by searchMode',
          });
        }
        const res = await this.aiSearch(query);
        dedupeSource(res.sources || []);
        if (Array.isArray(res.followUps) && res.followUps.length > 0) {
          followUps = res.followUps;
        }
        if (typeof res.confidence === 'number') {
          confidence = res.confidence;
        }
        return JSON.stringify({
          answer: res.answer || '',
          sources: (res.sources || []).slice(0, 8),
          followUps: res.followUps || [],
          confidence: res.confidence,
        });
      },
      {
        name: 'external_ai_search',
        description: '调用外部AI搜索（PydanticAI Agent）获取补充答案与追问',
        schema: z.object({
          query: z.string(),
        }),
      },
    );

    const tools = searchMode === 'hybrid' ? [internalTool, externalTool] : [internalTool];
    const systemPrompt = [
      '你是工单系统知识库助手，必须通过工具获取事实，不得编造。',
      `当前检索模式: ${searchMode}`,
      '当模式为 internal 时，禁止使用 external_ai_search。',
      '输出中文，结构清晰，先给结论，再给关键依据，最后可给下一步建议。',
      '不要原样复读工具JSON，要整理成可读答案。',
    ].join('\n');

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
