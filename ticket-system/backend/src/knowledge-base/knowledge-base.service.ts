import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

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

    const kb = await this.smartQuery(
      params.message,
      5,
      history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    );
    const ai =
      usedSearchMode === 'hybrid'
        ? await this.aiSearch(params.message)
        : { answer: '', sources: [] as KBSearchResult[], followUps: [] as string[], confidence: undefined };

    const answerParts: string[] = [];
    if (kb.answer) answerParts.push(`【内部知识库】\n${kb.answer}`);
    if (ai.answer) answerParts.push(`【AI 搜索】\n${ai.answer}`);
    const answer = answerParts.join('\n\n') || '暂未检索到可用答案，请换个问法试试。';

    await this.addMessage(sessionId, 'assistant', answer, usedSearchMode);
    const messages = await this.getSessionMessages(sessionId, params.userId);

    return {
      sessionId,
      answer,
      sources: [...kb.sources, ...ai.sources].slice(0, 10),
      followUps: ai.followUps || [],
      confidence: ai.confidence,
      usedSearchMode,
      messages,
    };
  }
}
