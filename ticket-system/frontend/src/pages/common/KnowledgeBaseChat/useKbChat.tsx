import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Button, Typography, Space, message, List, Tag, Spin, Avatar, Modal, Upload, Select, Tooltip } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  RobotOutlined,
  UserOutlined,
  SendOutlined,
  ReloadOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
  GlobalOutlined,
  CodeOutlined,
  CopyOutlined,
  UploadOutlined,
  InfoCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../../../api/axios';
import { apiUrl } from '../../../config/apiBase';
import { useAuth } from '../../../contexts/AuthContext';

const { TextArea } = Input;
const { Title, Text } = Typography;

/** 与 Postman「Copy as cURL」一致的多行格式；勿加 shebang、set -e、-w 等，避免与真实请求不一致 */
const CURL_EXAMPLE_TEMPLATE = `curl --location 'https://YOUR_RESOURCE.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer <API_KEY>' \\
--data '{
        "messages": [
            {
                "role": "user",
                "content": "你好"
            }
        ],
        "max_completion_tokens": 16384,
        "model": "你的部署名或模型名"
    }'
`;

type ChatItem = { role: 'user' | 'assistant'; content: string; searchMode?: 'internal' | 'hybrid' };
type ThinkRound = {
  id: string;
  question: string;
  think: string;
  searchMode: 'internal' | 'hybrid';
  createdAt: string;
};
type DocAttachment = {
  uid: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  kind: 'word' | 'txt' | 'table' | 'image';
  parsedText: string;
  error?: string;
};

export function useKbChat() {
  const { user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const [customerCode, setCustomerCode] = useState('');
  const [verifiedCode, setVerifiedCode] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>(() => {
    try {
      const raw = localStorage.getItem('kb-chat-history');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [sources, setSources] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('kb-chat-session-id') || '');
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState<'internal' | 'hybrid'>(() => {
    const v = localStorage.getItem('kb-chat-search-mode');
    return v === 'hybrid' ? 'hybrid' : 'internal';
  });
  const [aiSearchDepth, setAiSearchDepth] = useState<'fast' | 'deep'>(() => {
    const v = localStorage.getItem('kb-ai-search-depth');
    return v === 'fast' || v === 'quick' ? 'fast' : 'deep';
  });
  const [usedSearchMode, setUsedSearchMode] = useState<'internal' | 'hybrid'>('internal');
  const [sandboxMode, setSandboxMode] = useState(() => localStorage.getItem('kb-sandbox-mode') === '1');
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [requestExampleText, setRequestExampleText] = useState('');
  const [exampleFileList, setExampleFileList] = useState<UploadFile[]>([]);
  const [docFileList, setDocFileList] = useState<UploadFile[]>([]);
  const [docAttachments, setDocAttachments] = useState<DocAttachment[]>([]);
  const [docContextText, setDocContextText] = useState('');
  const [docContextName, setDocContextName] = useState('');
  const [docGenMode, setDocGenMode] = useState(() => localStorage.getItem('kb-doc-gen-mode') === '1');
  const [workspaceVisible, setWorkspaceVisible] = useState(() => localStorage.getItem('kb-doc-gen-mode') === '1');
  const [workspaceText, setWorkspaceText] = useState('');
  const [docGenLoading, setDocGenLoading] = useState(false);
  const [docGenResult, setDocGenResult] = useState<{ filename: string; url: string; outputType: string } | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState('');
  const [retrievalStatus, setRetrievalStatus] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const [chatHistoryList, setChatHistoryList] = useState<any[]>([]);
  const [aiSearchStreamText, setAiSearchStreamText] = useState('');
  /** 主模型 reasoning / Agent 工具步骤（SSE llm_think），与左侧最终回答正文分离 */
  const [llmThinkText, setLlmThinkText] = useState('');
  const [thinkHistory, setThinkHistory] = useState<ThinkRound[]>([]);
  const [ticketOptions, setTicketOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [selectedTickets, setSelectedTickets] = useState<any[]>([]);
  const [ticketLoading, setTicketLoading] = useState(false);
  const llmThinkRef = useRef('');
  const aiSearchThinkEventsRef = useRef<Set<string>>(new Set());

  const canAsk = useMemo(() => {
    if (isCustomer) return !!verifiedCode;
    return true;
  }, [isCustomer, verifiedCode]);
  const shouldShowThinkPanel =
    !!llmThinkText ||
    thinkHistory.length > 0 ||
    !!aiSearchStreamText ||
    !!sandboxStatus ||
    !!retrievalStatus;

  const markdownComponents = useMemo(
    () => ({
      code({ inline, className, children, ...props }: any) {
        const raw = String(children ?? '');
        if (inline) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
        const codeText = raw.replace(/\n$/, '');
        return (
          <div style={{ position: 'relative' }}>
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(codeText);
                  message.success('代码已复制');
                } catch {
                  message.error('复制失败');
                }
              }}
              style={{
                position: 'absolute',
                right: 8,
                top: 8,
                color: '#d1d5db',
                zIndex: 1,
              }}
            >
              复制代码
            </Button>
            <pre>
              <code className={className} {...props}>
                {codeText}
              </code>
            </pre>
          </div>
        );
      },
    }),
    [],
  );

  const docEvidenceSummary = useMemo(() => {
    const lastAssistant = [...chat].reverse().find((m) => m.role === 'assistant')?.content?.trim() || '';
    const lastUser = [...chat].reverse().find((m) => m.role === 'user')?.content?.trim() || '';
    const topSources = (sources || []).slice(0, 5);
    const conclusion = (lastAssistant || lastUser || '暂无结论').slice(0, 220);
    const keyPoints = [
      sandboxStatus ? `沙盒状态：${sandboxStatus}` : '',
      retrievalStatus ? `检索状态：${retrievalStatus}` : '',
      docContextName.trim() ? `附件：${docContextName.trim()}` : '',
      requestExampleText.trim() ? '已提供请求示例（用于复现）' : '',
    ].filter(Boolean);
    const refs = topSources.map((s: any, i: number) => {
      const t = s?.title || '未命名资料';
      const u = typeof s?.url === 'string' ? s.url.trim() : '';
      return u ? `${i + 1}. ${t} (${u})` : `${i + 1}. ${t}`;
    });
    return { conclusion, keyPoints, refs };
  }, [chat, sources, sandboxStatus, retrievalStatus, docContextName, requestExampleText]);

  const verifyCode = () => {
    if (!customerCode.trim()) return message.warning('请先输入客户编号');
    setVerifiedCode(customerCode.trim());
    message.success('客户编号已确认，可以开始知识库对话');
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条历史对话吗？删除后无法恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.delete(`/knowledge-base/chat/sessions/${id}`);
          message.success('删除成功');
          setChatHistoryList((prev) => prev.filter((item) => item.id !== id));
          if (sessionId === id) {
            setSessionId('');
            setChat([]);
            setSources([]);
            setFollowUps([]);
            setLlmThinkText('');
            setThinkHistory([]);
            llmThinkRef.current = '';
            localStorage.removeItem('kb-chat-session-id');
            localStorage.removeItem('kb-chat-history');
          }
        } catch (err) {
          message.error('删除失败');
        }
      },
    });
  };

  useEffect(() => {
    // 组件挂载时，如果有 sessionId，尝试从后端拉取历史记录
    if (sessionId) {
      api.get(`/knowledge-base/chat/${sessionId}`)
        .then(({ data }) => {
          if (Array.isArray(data) && data.length > 0) {
            setChat((prev) => {
              // 避免：再次提问已乐观追加本地消息时，较慢的 GET 把界面刷回旧历史
              if (prev.length > data.length) return prev;
              localStorage.setItem('kb-chat-history', JSON.stringify(data));
              return data;
            });
          }
        })
        .catch(() => {
          // 忽略错误，降级使用本地缓存
        });
    }

    // 尝试拉取用户的历史会话列表
    api.get('/knowledge-base/chat/sessions/list')
      .then(({ data }) => {
        if (Array.isArray(data)) {
          setChatHistoryList(data);
        }
      })
      .catch(() => {});

    // 右侧工单明细选择器：拉取可选工单列表（按当前用户权限返回）
    if (!isCustomer) {
      api.get('/tickets', { params: { page: 1, pageSize: 100 } })
        .then(({ data }) => {
          const list = Array.isArray(data?.tickets) ? data.tickets : [];
          setTicketOptions(
            list.map((t: any) => ({
              value: t.id,
              label: `${t.ticketNumber || t.id} · ${t.status || ''}`,
            })),
          );
        })
        .catch(() => {});
    } else {
      setTicketOptions([]);
      setSelectedTicketIds([]);
      setSelectedTickets([]);
    }
  }, [sessionId, isCustomer]);

  const buildTicketContext = (tickets: any[]): string => {
    if (!tickets.length) return '';
    return tickets
      .map((t, idx) =>
        [
          `### 工单 ${idx + 1}`,
          `工单编号: ${t.ticketNumber || t.id || ''}`,
          `状态: ${t.status || ''}`,
          `平台: ${t.platform || ''}`,
          `模型: ${t.modelUsed || ''}`,
          t.framework ? `框架/应用: ${t.framework}` : '',
          t.networkEnv ? `网络环境: ${t.networkEnv}` : '',
          t.accountInfo ? `账号信息: ${t.accountInfo}` : '',
          `问题描述:\n${t.description || ''}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
  };

  const buildSandboxRequestFromTickets = (tickets: any[]): string => {
    const samples = tickets
      .map((t) => (typeof t?.requestExample === 'string' ? t.requestExample.trim() : ''))
      .filter(Boolean);
    if (!samples.length) return '';
    return samples.join('\n\n# ---- 来自其他工单请求示例 ----\n\n');
  };

  const getDocKind = (name: string): DocAttachment['kind'] | null => {
    const n = name.toLowerCase();
    if (n.endsWith('.doc') || n.endsWith('.docx')) return 'word';
    if (n.endsWith('.txt')) return 'txt';
    if (n.endsWith('.csv') || n.endsWith('.xls') || n.endsWith('.xlsx')) return 'table';
    if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.webp') || n.endsWith('.gif')) return 'image';
    return null;
  };

  const removeDocAttachment = (uid: string) => {
    setDocAttachments((prev) => prev.filter((f) => f.uid !== uid));
  };

  useEffect(() => {
    const ready = docAttachments.filter((f) => f.status === 'done');
    const ctx = ready.map((f) => f.parsedText).filter(Boolean).join('\n\n');
    setDocContextText(ctx);
    setDocContextName(ready.map((f) => f.name).join(', '));
    setDocFileList(ready.map((f) => ({ uid: f.uid, name: f.name, status: 'done' as const })));
  }, [docAttachments]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chat, loading]);

  const fetchWithAuthStream = async (url: string, init: RequestInit): Promise<Response> => {
    let token = localStorage.getItem('accessToken');
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      const rt = localStorage.getItem('refreshToken');
      if (rt) {
        const rr = await fetch(apiUrl('/api/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (rr.ok) {
          const d = await rr.json();
          localStorage.setItem('accessToken', d.accessToken);
          token = d.accessToken;
          headers.set('Authorization', `Bearer ${token}`);
          res = await fetch(url, { ...init, headers });
        }
      }
    }
    return res;
  };

  const ask = async (overrideQuestion?: string) => {
    const q = (overrideQuestion || question).trim();
    if (!q) return;
    if (!canAsk) return message.warning('客户请先输入并确认客户编号');
    if (sandboxMode && !requestExampleText.trim()) {
      message.warning('已开启沙盒排错：请先打开「请求示例」，粘贴或上传客户请求脚本');
      setExampleModalOpen(true);
      return;
    }

    const userMsg: ChatItem = { role: 'user', content: q, searchMode };
    const placeholderAssistant: ChatItem = { role: 'assistant', content: '', searchMode };
    const nextChat = [...chat, userMsg, placeholderAssistant];
    setChat(nextChat);
    localStorage.setItem('kb-chat-history', JSON.stringify([...chat, userMsg]));
    setQuestion('');
    setLoading(true);
    setAiSearchStreamText('');
    setLlmThinkText('');
    llmThinkRef.current = '';
    aiSearchThinkEventsRef.current.clear();
    setSandboxStatus('');
    setRetrievalStatus('');
    let acc = '';
    let roundMode: 'internal' | 'hybrid' = searchMode;
    let gotDone = false;

    const patchAssistant = (text: string) => {
      acc = text;
      setChat((prev) => {
        const c = [...prev];
        const last = c.length - 1;
        if (last >= 0 && c[last].role === 'assistant') {
          c[last] = { ...c[last], content: text, searchMode: roundMode };
        }
        return c;
      });
    };

    const appendThinkDelta = (delta: string) => {
      if (!delta) return;
      setLlmThinkText((prev) => {
        const next = prev + delta;
        const max = 48000;
        const capped = next.length > max ? next.slice(next.length - max) : next;
        llmThinkRef.current = capped;
        return capped;
      });
    };

    try {
      const ticketContext = buildTicketContext(selectedTickets);
      const mergedMessage = ticketContext
        ? `${userMsg.content}\n\n---\n【关联工单明细】\n${ticketContext}`
        : userMsg.content;
      const ticketSandboxRequest = buildSandboxRequestFromTickets(selectedTickets);
      const finalRequestExample = requestExampleText.trim() || (sandboxMode ? ticketSandboxRequest : '');
      const finalDocContext = docContextText.trim();
      const finalDocName = docContextName.trim();

      const res = await fetchWithAuthStream(apiUrl('/api/knowledge-base/chat/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          message: mergedMessage,
          searchMode,
          ...(searchMode === 'hybrid' ? { aiSearchDepth } : {}),
          ...(sandboxMode && finalRequestExample
            ? { useSandbox: true, requestExample: finalRequestExample }
            : {}),
          ...(finalDocContext ? { docContext: finalDocContext, docName: finalDocName || undefined } : {}),
          ...(isCustomer ? { customerCode: verifiedCode } : {}),
        }),
      });
      if (!res.ok) {
        const status = res.status;
        const text = await res.text().catch(() => '');
        let errMsg = `知识库对话失败（HTTP ${status}）`;
        try {
          const j = JSON.parse(text);
          if (j?.message) errMsg = `${errMsg} ${j.message}`;
        } catch {
          if (text?.trim()) errMsg = `${errMsg} ${text.trim().slice(0, 280)}`;
        }
        throw new Error(errMsg);
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) {
        throw new Error(
          '接口返回了 HTML（多为 SPA 首页）：请检查 Static Web App 是否将 /api 反代到 Nest 后端，或本地 Vite 代理是否保留 /api 前缀。',
        );
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取流式响应');
      const dec = new TextDecoder();
      let buf = '';

      const handleSsePayload = (raw: string) => {
        if (!raw.trim()) return;
        let json: any;
        try {
          json = JSON.parse(raw);
        } catch {
          return;
        }
        if (json.type === 'session') {
          if (json.sessionId) {
            setSessionId(json.sessionId);
            localStorage.setItem('kb-chat-session-id', json.sessionId);
          }
          if (json.usedSearchMode === 'hybrid' || json.usedSearchMode === 'internal') {
            roundMode = json.usedSearchMode;
            setUsedSearchMode(roundMode);
          }
        } else if (json.type === 'token' && json.source === 'llm' && typeof json.text === 'string') {
          patchAssistant(acc + json.text);
          if (workspaceVisible) setWorkspaceText(acc + json.text);
        } else if (json.type === 'llm_think' && typeof json.text === 'string' && json.text) {
          appendThinkDelta(json.text);
        } else if (json.type === 'ai_search_token' && typeof json.text === 'string') {
          setAiSearchStreamText((s) => s + json.text);
        } else if (json.type === 'status') {
          if (json.phase === 'sandbox') {
            setSandboxStatus(json.detail === 'start' ? '正在 Daytona 沙盒中复现请求…' : '沙盒执行完成');
          } else if (json.phase === 'internal_kb') {
            setRetrievalStatus(
              json.detail === 'start' ? '正在检索内部知识库…' : '内部知识库检索完成',
            );
          } else if (json.phase === 'ai_search') {
            setRetrievalStatus(
              json.detail === 'start' ? '正在调用外部 AI 搜索…' : '外部 AI 搜索完成',
            );
          } else if (json.phase === 'jina_initialize') {
            setRetrievalStatus(json.detail === 'start' ? '正在初始化 Jina MCP…' : 'Jina MCP 已就绪');
          } else if (json.phase === 'jina_fast_search') {
            setRetrievalStatus(json.detail === 'start' ? 'Fast 模式：正在外部检索…' : 'Fast 模式检索完成');
          } else if (json.phase === 'deep_expand_query') {
            setRetrievalStatus(json.detail === 'start' ? 'Deep 模式：正在扩展查询…' : 'Deep 模式：查询扩展完成');
          } else if (json.phase === 'deep_parallel_search') {
            setRetrievalStatus(json.detail === 'start' ? 'Deep 模式：并行检索中…' : 'Deep 模式：并行检索完成');
          } else if (json.phase === 'deep_rerank') {
            setRetrievalStatus(json.detail === 'start' ? 'Deep 模式：重排中…' : 'Deep 模式：重排完成');
            if (json.detail === 'start' && !aiSearchThinkEventsRef.current.has('deep_rerank')) {
              aiSearchThinkEventsRef.current.add('deep_rerank');
              appendThinkDelta('\n▸ Deep 重排：根据问题语义对内外部候选来源重新排序。\n');
            }
          } else {
            setRetrievalStatus(
              [json.phase, json.detail, json.tool].filter(Boolean).join(' · ') || '检索中…',
            );
          }
        } else if (json.type === 'meta') {
          setSources(Array.isArray(json.sources) ? json.sources : []);
          setFollowUps(Array.isArray(json.followUps) ? json.followUps : []);
        } else if (json.type === 'done' && Array.isArray(json.messages)) {
          gotDone = true;
          if (llmThinkRef.current.trim()) {
            const currentThink = llmThinkRef.current.trim();
            setThinkHistory((prev) => [
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                question: userMsg.content,
                think: currentThink,
                searchMode: roundMode,
                createdAt: new Date().toISOString(),
              },
              ...prev,
            ].slice(0, 20));
          }
          setLoading(false);
          setSandboxStatus('');
          setRetrievalStatus('');
          aiSearchThinkEventsRef.current.clear();
          setAiSearchStreamText('');
          setChat(json.messages as ChatItem[]);
          localStorage.setItem('kb-chat-history', JSON.stringify(json.messages));
          if (workspaceVisible) {
            const msgs = json.messages as ChatItem[];
            const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
            if (lastAssistant?.content) setWorkspaceText(lastAssistant.content);
          }
        } else if (json.type === 'error') {
          setLoading(false);
          setSandboxStatus('');
          setRetrievalStatus('');
          setLlmThinkText('');
          llmThinkRef.current = '';
          aiSearchThinkEventsRef.current.clear();
          message.error(json.message || '流式对话出错');
        }
      };

      const parseSseBlock = (block: string) => {
        const lines = block.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
        const dataLines = lines.filter((l) => l.trimStart().startsWith('data:'));
        if (!dataLines.length) return;
        const raw = dataLines
          .map((l) => l.trimStart().replace(/^data:\s?/i, '').trim())
          .join('\n')
          .trim();
        handleSsePayload(raw);
      };

      const pullSseBlocks = (input: string): { blocks: string[]; rest: string } => {
        const blocks: string[] = [];
        let rest = input;
        while (true) {
          const m = rest.match(/\r?\n\r?\n/);
          if (!m || m.index === undefined) break;
          const idx = m.index;
          blocks.push(rest.slice(0, idx));
          rest = rest.slice(idx + m[0].length);
        }
        return { blocks, rest };
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { blocks, rest } = pullSseBlocks(buf);
        buf = rest;
        for (const block of blocks) {
          parseSseBlock(block);
        }
      }
      if (buf.trim()) {
        parseSseBlock(buf);
      }
      if (!gotDone) {
        setChat((prev) => {
          const copy = [...prev];
          const last = copy.length - 1;
          if (last >= 0 && copy[last].role === 'assistant') {
            const content = copy[last].content?.trim() || acc.trim();
            copy[last] = {
              ...copy[last],
              content: content || '未获取到答案',
              searchMode: roundMode,
            };
          }
          localStorage.setItem('kb-chat-history', JSON.stringify(copy));
          return copy;
        });
      }
    } catch (err: any) {
      message.error(err?.message || '知识库对话失败');
      setLlmThinkText('');
      llmThinkRef.current = '';
      aiSearchThinkEventsRef.current.clear();
      setChat((prev) => {
        const last = prev[prev.length - 1];
        if (prev.length >= 2 && last?.role === 'assistant' && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setLoading(false);
    }
  };

  const ensureWorkspaceDraft = () => {
    if (workspaceText.trim()) return;
    const lastUser = [...chat].reverse().find((m) => m.role === 'user')?.content || '';
    const lastAssistant = [...chat].reverse().find((m) => m.role === 'assistant')?.content || '';
    const pickedSources = (sources || []).slice(0, 6);
    const pickedMsgs = chat.slice(-8);
    const draft = [
      '【文档草稿】',
      '请基于当前对话与上下文生成一份可继续编辑的内容（若文档类型不明确默认 Word）。',
      lastUser ? `\n【用户最新诉求】\n${lastUser}` : '',
      requestExampleText.trim() ? `\n【沙盒请求示例】\n${requestExampleText.trim().slice(0, 4000)}` : '',
      pickedSources.length
        ? `\n【知识库命中】\n${pickedSources
            .map((s: any, i: number) => `- ${i + 1}. ${s?.title || '未命名资料'}${s?.url ? ` (${s.url})` : ''}`)
            .join('\n')}`
        : '',
      docContextText.trim() ? `\n【附件摘要】\n${docContextText.trim().slice(0, 4000)}` : '',
      pickedMsgs.length
        ? `\n【最近对话上下文】\n${pickedMsgs.map((m) => `- ${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n')}`
        : '',
      lastAssistant ? `\n【最近助手回答】\n${lastAssistant}` : '',
      '\n【当前文档正文（可直接编辑）】\n',
    ]
      .filter(Boolean)
      .join('\n');
    setWorkspaceText(draft);
  };

  const toggleDocGenMode = () => {
    const next = !docGenMode;
    setDocGenMode(next);
    setWorkspaceVisible(next);
    localStorage.setItem('kb-doc-gen-mode', next ? '1' : '0');
    if (next) {
      ensureWorkspaceDraft();
    }
  };

  const runDocGeneration = async () => {
    const seed =
      workspaceText.trim() ||
      chat.filter((m) => m.role === 'assistant').slice(-1)[0]?.content?.trim() ||
      question.trim();
    if (!seed) {
      message.warning('请先输入需求或先让助手产出内容');
      return;
    }
    setDocGenLoading(true);
    setDocGenResult(null);
    try {
      const prompt = seed.length > 12000 ? `${seed.slice(0, 12000)}\n... [内容已截断]` : seed;
      const { data } = await api.post('/knowledge-base/doc-generate', { prompt });
      setDocGenResult({
        filename: data?.filename || '未命名文件',
        url: data?.url || '',
        outputType: data?.outputType || 'word',
      });
      message.success(`文档生成成功（${(data?.outputType || 'word').toUpperCase()}）`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '文档生成失败');
    } finally {
      setDocGenLoading(false);
    }
  };

  const applyDocTemplate = (kind: 'polish' | 'expand' | 'table') => {
    const header =
      kind === 'polish'
        ? '【文档迭代指令】请在不改变事实的前提下润色语言，提升专业性与可读性。'
        : kind === 'expand'
          ? '【文档迭代指令】请基于现有内容扩写细节，补充步骤、风险和建议。'
          : '【文档迭代指令】请将现有内容重组为结构化表格，字段清晰、可直接导出。';
    const next = `${header}\n\n${workspaceText.trim() || '（当前正文为空，请基于证据摘要起草）'}`;
    setWorkspaceText(next);
    message.success('已应用文档迭代模板');
  };

  return {
    CURL_EXAMPLE_TEMPLATE,
    aiSearchDepth,
    aiSearchStreamText,
    applyDocTemplate,
    ask,
    canAsk,
    chat,
    chatHistoryList,
    customerCode,
    deleteSession,
    docAttachments,
    docEvidenceSummary,
    docGenLoading,
    docGenMode,
    docGenResult,
    exampleFileList,
    exampleModalOpen,
    followUps,
    getDocKind,
    isCustomer,
    llmThinkRef,
    llmThinkText,
    loading,
    markdownComponents,
    messagesRef,
    question,
    removeDocAttachment,
    requestExampleText,
    retrievalStatus,
    runDocGeneration,
    sandboxMode,
    sandboxStatus,
    searchMode,
    selectedTicketIds,
    selectedTickets,
    sessionId,
    setAiSearchDepth,
    setChat,
    setCustomerCode,
    setDocAttachments,
    setExampleFileList,
    setExampleModalOpen,
    setFollowUps,
    setLlmThinkText,
    setQuestion,
    setRequestExampleText,
    setSandboxMode,
    setSearchMode,
    setSelectedTicketIds,
    setSelectedTickets,
    setSessionId,
    setSources,
    setThinkHistory,
    setTicketLoading,
    setWorkspaceText,
    shouldShowThinkPanel,
    sources,
    thinkHistory,
    ticketLoading,
    ticketOptions,
    toggleDocGenMode,
    user,
    verifiedCode,
    verifyCode,
    workspaceText,
    workspaceVisible,
  };
}

export type KbChatContextType = ReturnType<typeof useKbChat>;
