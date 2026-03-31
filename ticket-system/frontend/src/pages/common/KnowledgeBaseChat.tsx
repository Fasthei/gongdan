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
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../../api/axios';
import { apiUrl } from '../../config/apiBase';
import { useAuth } from '../../contexts/AuthContext';

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

export default function KnowledgeBaseChat() {
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
  const [aiSearchDepth, setAiSearchDepth] = useState<'quick' | 'deep'>(() => {
    const v = localStorage.getItem('kb-ai-search-depth');
    return v === 'quick' ? 'quick' : 'deep';
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

  const canAsk = useMemo(() => {
    if (isCustomer) return !!verifiedCode;
    return true;
  }, [isCustomer, verifiedCode]);

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

  const ask = async () => {
    if (!question.trim()) return;
    if (!canAsk) return message.warning('客户请先输入并确认客户编号');
    if (sandboxMode && !requestExampleText.trim()) {
      message.warning('已开启沙盒排错：请先打开「请求示例」，粘贴或上传客户请求脚本');
      setExampleModalOpen(true);
      return;
    }

    const userMsg: ChatItem = { role: 'user', content: question.trim(), searchMode };
    const placeholderAssistant: ChatItem = { role: 'assistant', content: '', searchMode };
    const nextChat = [...chat, userMsg, placeholderAssistant];
    setChat(nextChat);
    localStorage.setItem('kb-chat-history', JSON.stringify([...chat, userMsg]));
    setQuestion('');
    setLoading(true);
    setAiSearchStreamText('');
    setLlmThinkText('');
    llmThinkRef.current = '';
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
          const delta = json.text;
          setLlmThinkText((prev) => {
            const next = prev + delta;
            const max = 48000;
            const capped = next.length > max ? next.slice(next.length - max) : next;
            llmThinkRef.current = capped;
            return capped;
          });
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
          } else if (json.phase === 'ai_search_sse' && json.detail) {
            setRetrievalStatus(`AI 搜索流: ${json.detail}`);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', background: '#fff', margin: '0' }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => window.history.back()} />
          <Title level={5} style={{ margin: 0 }}>知识库对话</Title>
        </Space>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            size="small"
            onClick={() => {
              setChat([]);
              setSources([]);
              setFollowUps([]);
              setLlmThinkText('');
              setThinkHistory([]);
              llmThinkRef.current = '';
              setSessionId('');
              localStorage.removeItem('kb-chat-history');
              localStorage.removeItem('kb-chat-session-id');
            }}
          >
            新会话
          </Button>
        </Space>
      </div>

      {isCustomer && !verifiedCode ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
          <div style={{ background: '#fff', padding: 40, borderRadius: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
            <Title level={4} style={{ marginBottom: 24 }}>验证客户身份</Title>
            <Space direction="vertical" size="large" style={{ width: 300 }}>
              <Input
                size="large"
                value={customerCode}
                onChange={(e) => setCustomerCode(e.target.value)}
                placeholder="请输入您的客户编号"
              />
              <Button type="primary" size="large" block onClick={verifyCode}>开始对话</Button>
            </Space>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left Sidebar for Chat History */}
          <div style={{ width: 260, borderRight: '1px solid #f0f0f0', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0' }}>
              <Button 
                type="dashed" 
                block 
                icon={<PlusOutlined />} 
                onClick={() => {
                  setChat([]);
                  setSources([]);
                  setFollowUps([]);
                  setLlmThinkText('');
                  setThinkHistory([]);
                  llmThinkRef.current = '';
                  setSessionId('');
                  localStorage.removeItem('kb-chat-history');
                  localStorage.removeItem('kb-chat-session-id');
                }}
              >
                开启新对话
              </Button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {chatHistoryList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#bfbfbf', fontSize: 13 }}>暂无历史对话</div>
              ) : (
                <List
                  dataSource={chatHistoryList}
                  renderItem={(item) => (
                    <List.Item 
                      style={{ 
                        padding: '10px 12px', 
                        cursor: 'pointer', 
                        borderRadius: 8,
                        background: sessionId === item.id ? '#e6f4ff' : 'transparent',
                        borderBottom: 'none',
                        marginBottom: 4
                      }}
                      onClick={() => {
                        setSessionId(item.id);
                        localStorage.setItem('kb-chat-session-id', item.id);
                      }}
                    >
                      <div style={{ width: '100%', overflow: 'hidden' }}>
                        <Text ellipsis style={{ display: 'block', fontSize: 14, color: sessionId === item.id ? '#1677ff' : '#333' }}>
                          {item.title || '新对话'}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </Text>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </div>

          {/* Main Chat Area：仅左侧消息区滚动，右侧参考资料/追问固定在同一视口内独立滚动 */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              minHeight: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'row',
              gap: workspaceVisible ? 16 : 24,
                padding: '0 24px',
                minHeight: 0,
                maxWidth: 1200,
                width: '100%',
                margin: '0 auto',
                alignItems: 'stretch',
              }}
            >
              {/* Main Chat Stream — 仅此列纵向滚动 */}
              <div
                ref={messagesRef}
                style={{
                  flex: workspaceVisible ? '0 0 58%' : 1,
                  minWidth: 0,
                  maxWidth: 800,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  padding: '24px 0',
                  scrollBehavior: 'smooth',
                }}
              >
                {sandboxMode && requestExampleText.trim() ? (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#e8f5e9', borderRadius: 8, fontSize: 12, color: '#2e7d32' }}>
                    沙盒排错已启用，已载入请求示例（{requestExampleText.length} 字符）。发送问题时将自动复现并结合知识库/模型检索排错。
                  </div>
                ) : null}
                {chat.length === 0 && !loading && (
                  <div style={{ textAlign: 'center', marginTop: '10vh', color: '#8e8e8e' }}>
                    <RobotOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }} />
                    <Title level={3} style={{ color: '#d9d9d9', fontWeight: 400 }}>今天能帮您解决什么问题？</Title>
                  </div>
                )}
                <List
                  dataSource={chat}
                  split={false}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '16px 0' }}>
                      <div style={{ width: '100%', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                        <Avatar
                          icon={item.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                          style={{
                            background: item.role === 'user' ? '#1a73e8' : '#10a37f',
                            flex: '0 0 auto',
                            marginTop: 4,
                          }}
                        />
                        <div style={{ width: '100%', overflow: 'hidden' }}>
                          <div style={{ fontWeight: 500, marginBottom: 4, color: '#202124' }}>
                            {item.role === 'user' ? '您' : '知识库助手'}
                          </div>
                          <div className="markdown-body" style={{ color: '#3c4043', fontSize: 15, lineHeight: 1.6, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                            {item.role === 'user' ? (
                              <div style={{ whiteSpace: 'pre-wrap' }}>{item.content}</div>
                            ) : (
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {item.content}
                              </ReactMarkdown>
                            )}
                          </div>
                          {item.searchMode && (
                            <div style={{ marginTop: 8 }}>
                              <Tag bordered={false} color="default" style={{ fontSize: 12, borderRadius: 4 }}>
                                {item.searchMode === 'hybrid' ? '检索来源: AI 搜索' : '检索来源: 内部知识库'}
                              </Tag>
                            </div>
                          )}
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
                {loading &&
                  chat.length > 0 &&
                  chat[chat.length - 1]?.role === 'assistant' &&
                  !chat[chat.length - 1]?.content && (
                    <div style={{ padding: '16px 0', display: 'flex', gap: 16 }}>
                      <Avatar icon={<RobotOutlined />} style={{ background: '#10a37f', flex: '0 0 auto' }} />
                      <div style={{ paddingTop: 6 }}>
                        <Spin size="small" /> <Text type="secondary" style={{ marginLeft: 8 }}>正在思考并检索...</Text>
                      </div>
                    </div>
                  )}
              </div>

              {workspaceVisible ? (
                <div
                  style={{
                    flex: '0 0 42%',
                    minWidth: 320,
                    borderLeft: '1px solid #f0f0f0',
                    padding: '24px 0 24px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong>文档工作区</Text>
                    <Space size={6}>
                      <Button size="small" icon={<DownloadOutlined />} onClick={runDocGeneration} loading={docGenLoading}>
                        文档生成
                      </Button>
                      <Button size="small" onClick={() => setWorkspaceText('')}>清空</Button>
                    </Space>
                  </div>
                  <Space size={6} wrap>
                    <Button size="small" onClick={() => applyDocTemplate('polish')}>润色</Button>
                    <Button size="small" onClick={() => applyDocTemplate('expand')}>扩写</Button>
                    <Button size="small" onClick={() => applyDocTemplate('table')}>改成表格</Button>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    文档类型由 Agent 根据你的输入自动判断；如果不明确默认生成 Word。
                  </Text>
                  <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                    <Text strong style={{ fontSize: 12 }}>结构化证据摘要</Text>
                    <div style={{ marginTop: 6 }}>
                      <Text style={{ fontSize: 12 }}><strong>结论：</strong>{docEvidenceSummary.conclusion}</Text>
                    </div>
                    {docEvidenceSummary.keyPoints.length > 0 ? (
                      <div style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 12, display: 'block', marginBottom: 2 }}><strong>要点：</strong></Text>
                        {docEvidenceSummary.keyPoints.map((k, i) => (
                          <Text key={i} style={{ fontSize: 12, display: 'block' }}>- {k}</Text>
                        ))}
                      </div>
                    ) : null}
                    {docEvidenceSummary.refs.length > 0 ? (
                      <div style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 12, display: 'block', marginBottom: 2 }}><strong>来源：</strong></Text>
                        {docEvidenceSummary.refs.map((r, i) => (
                          <Text key={i} style={{ fontSize: 12, display: 'block' }}>{r}</Text>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <TextArea
                    value={workspaceText}
                    onChange={(e) => setWorkspaceText(e.target.value)}
                    placeholder="在此编辑你的文稿..."
                    style={{ flex: 1, minHeight: 360 }}
                  />
                  {docGenResult ? (
                    <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: 12 }}>
                      <Text strong>已生成：{docGenResult.filename}</Text>
                      <div style={{ marginTop: 8 }}>
                        {docGenResult.url ? (
                          <a href={docGenResult.url} target="_blank" rel="noreferrer">下载文档</a>
                        ) : (
                          <Text type="warning">未返回可下载链接</Text>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Right Sidebar — 与左侧同高，内容多时在侧栏内滚动，不随对话滚动上移 */}
              <div
                style={{
                  width: 300,
                  flexShrink: 0,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  padding: '24px 0',
                  display:
                    chat.length > 0 ||
                    loading ||
                    !!sandboxStatus ||
                    !!retrievalStatus ||
                    !!llmThinkText ||
                    thinkHistory.length > 0 ||
                    sources.length > 0 ||
                    followUps.length > 0
                      ? 'block'
                      : 'none',
                }}
              >
                {(loading || llmThinkText || thinkHistory.length > 0) && (
                  <div style={{ marginBottom: 24, padding: 16, background: '#f8f9fa', borderRadius: 12 }}>
                    <Text strong style={{ display: 'block', marginBottom: 12 }}>思考状态</Text>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      {loading ? (
                        <>
                          {sandboxStatus ? (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              <Spin size="small" style={{ marginRight: 8 }} /> {sandboxStatus}
                            </Text>
                          ) : null}
                          {retrievalStatus ? (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              <Spin size="small" style={{ marginRight: 8 }} />
                              {retrievalStatus}
                            </Text>
                          ) : null}
                          <Text type="secondary" style={{ fontSize: 13 }}>
                            <Spin size="small" style={{ marginRight: 8 }} /> 分析问题中…
                          </Text>
                          {usedSearchMode === 'hybrid' ? (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              <Spin size="small" style={{ marginRight: 8 }} /> 调用 AI 搜索 Agent…
                            </Text>
                          ) : null}
                          <Text type="secondary" style={{ fontSize: 13 }}>
                            <Spin size="small" style={{ marginRight: 8 }} /> 检索内部知识库…
                          </Text>
                        </>
                      ) : null}
                      {aiSearchStreamText ? (
                        <div style={{ marginTop: 8, maxHeight: 160, overflow: 'auto' }}>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                            AI 搜索（流式）
                          </Text>
                          <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{aiSearchStreamText}</Text>
                        </div>
                      ) : null}
                      {llmThinkText ? (
                        <details open style={{ marginTop: loading ? 8 : 0 }}>
                          <summary style={{ cursor: 'pointer', color: '#5f6368', fontSize: 12 }}>
                            当前轮主模型推理 / Agent 步骤
                          </summary>
                          <div style={{ maxHeight: loading ? 220 : 360, overflow: 'auto', marginTop: 8 }}>
                            <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.55, color: '#5f6368' }}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {llmThinkText}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </details>
                      ) : null}
                      {thinkHistory.length > 0 ? (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ cursor: 'pointer', color: '#5f6368', fontSize: 12 }}>
                            历史思考（按轮次，最近 {thinkHistory.length} 轮）
                          </summary>
                          <div style={{ marginTop: 8, maxHeight: 320, overflow: 'auto' }}>
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                              {thinkHistory.map((r) => (
                                <details key={r.id} style={{ background: '#fff', borderRadius: 8, padding: '8px 10px' }}>
                                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#5f6368' }}>
                                    {new Date(r.createdAt).toLocaleTimeString()} · {r.searchMode === 'hybrid' ? 'AI 搜索' : '内部知识库'} · {r.question.slice(0, 32)}
                                  </summary>
                                  <div style={{ marginTop: 8 }}>
                                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                                      问题：{r.question}
                                    </Text>
                                    <div className="markdown-body" style={{ fontSize: 12, lineHeight: 1.5, color: '#5f6368' }}>
                                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                        {r.think}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                </details>
                              ))}
                            </Space>
                          </div>
                        </details>
                      ) : null}
                    </Space>
                  </div>
                )}

                {sources.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <Text strong style={{ display: 'block', marginBottom: 12 }}>参考资料</Text>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      {sources.map((s: any, idx) => {
                        const rawUrl = typeof s.url === 'string' ? s.url.trim() : '';
                        const refUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
                        const title = s.title || '未命名资料';
                        return (
                          <div key={idx} style={{ background: '#f1f3f4', padding: '8px 12px', borderRadius: 8 }}>
                            {refUrl ? (
                              <a
                                href={refUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: 13,
                                  fontWeight: 500,
                                  color: '#1a73e8',
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  textDecoration: 'none',
                                }}
                                title={title}
                              >
                                {title}
                              </a>
                            ) : (
                              <Text style={{ fontSize: 13, display: 'block', fontWeight: 500 }} ellipsis={{ tooltip: title }}>
                                {title}
                              </Text>
                            )}
                            {s.platform && <Text type="secondary" style={{ fontSize: 12 }}>来源: {s.platform}</Text>}
                          </div>
                        );
                      })}
                    </Space>
                  </div>
                )}

                {!isCustomer ? (
                  <div style={{ marginBottom: 24 }}>
                    <Space size={6} align="center" style={{ marginBottom: 12 }}>
                      <Text strong style={{ marginBottom: 0 }}>工单明细</Text>
                      <Tooltip
                        title="提示：开启“沙盒”后，系统会默认将所选工单中的请求示例自动带入沙盒执行（若你未手动填写请求示例）。"
                        placement="topRight"
                      >
                        <InfoCircleOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
                      </Tooltip>
                    </Space>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Select
                        showSearch
                        mode="multiple"
                        allowClear
                        placeholder="可选择多个工单作为对话上下文"
                        optionFilterProp="label"
                        value={selectedTicketIds}
                        options={ticketOptions}
                        onChange={async (v) => {
                          const ids = Array.isArray(v) ? v.filter(Boolean) : [];
                          setSelectedTicketIds(ids);
                          if (ids.length === 0) {
                            setSelectedTickets([]);
                            return;
                          }
                          setTicketLoading(true);
                          try {
                            const rows = await Promise.all(
                              ids.map(async (id) => {
                                const { data } = await api.get(`/tickets/${id}`);
                                return data?.ticket || data;
                              }),
                            );
                            setSelectedTickets(rows.filter(Boolean));
                          } catch {
                            message.error('加载工单明细失败');
                          } finally {
                            setTicketLoading(false);
                          }
                        }}
                        style={{ width: '100%' }}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        已选择 {selectedTicketIds.length} 个工单；发送消息时将自动作为上下文参与分析。
                      </Text>
                      {ticketLoading ? <Spin size="small" /> : null}
                      {selectedTickets.length > 0 ? (
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ cursor: 'pointer', color: '#5f6368', fontSize: 12 }}>
                            预览将带入的多工单上下文摘要
                          </summary>
                          <div style={{ marginTop: 8, maxHeight: 240, overflow: 'auto', background: '#fafafa', borderRadius: 8, padding: 10 }}>
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                              {selectedTickets.map((t: any, idx: number) => (
                                <div key={t?.id || `${idx}`} style={{ background: '#fff', borderRadius: 6, padding: '8px 10px' }}>
                                  <Text strong style={{ fontSize: 12 }}>
                                    {idx + 1}. {t?.ticketNumber || t?.id || '未知工单'}
                                  </Text>
                                  <div style={{ marginTop: 4 }}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      状态: {t?.status || '-'} · 平台: {t?.platform || '-'} · 模型: {t?.modelUsed || '-'}
                                    </Text>
                                  </div>
                                  <div style={{ marginTop: 4 }}>
                                    <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                      {(t?.description || '').slice(0, 180) || '（无问题描述）'}
                                      {(t?.description || '').length > 180 ? '…' : ''}
                                    </Text>
                                  </div>
                                </div>
                              ))}
                            </Space>
                          </div>
                        </details>
                      ) : null}
                    </Space>
                  </div>
                ) : null}

                {followUps.length > 0 && (
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: 12 }}>推荐追问</Text>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      {followUps.map((f, i) => (
                        <Button 
                          key={`${i}-${f}`} 
                          size="small" 
                          style={{ width: '100%', textAlign: 'left', height: 'auto', whiteSpace: 'normal', padding: '6px 12px' }} 
                          onClick={() => setQuestion(f)}
                        >
                          {f}
                        </Button>
                      ))}
                    </Space>
                  </div>
                )}
              </div>
            </div>

          {/* Input Area（与上方消息区同属主列，不单独随左侧滚动） */}
          <div style={{ padding: '0 24px 24px', background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 20%)' }}>
            <div style={{ maxWidth: 800, margin: '0 auto', marginLeft: 'calc(50% - 600px + 24px)', '@media (max-width: 1200px)': { marginLeft: 'auto' } } as any}>
              <div style={{ 
                position: 'relative', 
                boxShadow: '0 2px 6px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.05)', 
                borderRadius: 24,
                background: '#fff',
                padding: '8px 16px',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <TextArea
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="给知识库发送消息..."
                  bordered={false}
                  style={{ resize: 'none', boxShadow: 'none', marginBottom: 36 }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'absolute', bottom: 8, left: 16, right: 8, flexWrap: 'wrap', gap: 8 }}>
                  <Space size={8} wrap>
                  <Upload
                    accept=".doc,.docx,.txt,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif"
                    showUploadList={false}
                    multiple
                    beforeUpload={(file) => {
                      const kind = getDocKind(file.name);
                      if (!kind) {
                        message.warning('仅支持 Word/TXT/表格/图片 四类文件');
                        return Upload.LIST_IGNORE;
                      }
                      if (docAttachments.length >= 3) {
                        message.warning('最多上传 3 个文档');
                        return Upload.LIST_IGNORE;
                      }
                      const uid = file.uid;
                      setDocAttachments((prev) => [
                        ...prev,
                        { uid, name: file.name, status: 'uploading', kind, parsedText: '' },
                      ]);
                      const done = (parsedText: string) => {
                        setDocAttachments((prev) =>
                          prev.map((f) => (f.uid === uid ? { ...f, status: 'done', parsedText } : f)),
                        );
                      };
                      const fail = (errMsg: string) => {
                        setDocAttachments((prev) =>
                          prev.map((f) => (f.uid === uid ? { ...f, status: 'error', error: errMsg } : f)),
                        );
                      };
                      if (kind === 'txt' || (kind === 'table' && file.name.toLowerCase().endsWith('.csv'))) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const text = String(reader.result || '');
                          const clipped = text.length > 120000 ? `${text.slice(0, 120000)}\n... [文件内容已截断]` : text;
                          done(`--- 文件: ${file.name} ---\n${clipped}`);
                        };
                        reader.onerror = () => fail('读取失败');
                        reader.readAsText(file as Blob);
                      } else {
                        const kb = Math.max(1, Math.round(file.size / 1024));
                        const note =
                          kind === 'image'
                            ? `--- 图片文件: ${file.name} ---\n[图片已上传，当前仅附带文件元信息，大小 ${kb}KB]`
                            : `--- 文件: ${file.name} ---\n[二进制文档已上传，当前仅附带文件元信息，大小 ${kb}KB]`;
                        done(note);
                      }
                      return false;
                    }}
                  >
                    <Button shape="circle" size="small" icon={<PlusOutlined />} title="上传文档（最多3个）" />
                  </Upload>
                  <Button
                    shape="round"
                    size="small"
                    icon={<GlobalOutlined />}
                    onClick={() => {
                      const next = searchMode === 'hybrid' ? 'internal' : 'hybrid';
                      setSearchMode(next);
                      localStorage.setItem('kb-chat-search-mode', next);
                    }}
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      background: searchMode === 'hybrid' ? '#202124' : '#f1f3f4',
                      color: searchMode === 'hybrid' ? '#fff' : '#5f6368',
                    }}
                  >
                    AI 搜索
                  </Button>
                  {searchMode === 'hybrid' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Button
                        size="small"
                        type={aiSearchDepth === 'quick' ? 'primary' : 'default'}
                        onClick={() => {
                          setAiSearchDepth('quick');
                          localStorage.setItem('kb-ai-search-depth', 'quick');
                        }}
                        style={{
                          borderRadius: 999,
                          border: aiSearchDepth === 'quick' ? '1px solid #1677ff' : '1px solid #d9d9d9',
                          boxShadow: aiSearchDepth === 'quick' ? '0 0 0 1px rgba(22,119,255,0.2)' : 'none',
                        }}
                      >
                        快速搜索
                      </Button>
                      <Button
                        size="small"
                        type={aiSearchDepth === 'deep' ? 'primary' : 'default'}
                        onClick={() => {
                          setAiSearchDepth('deep');
                          localStorage.setItem('kb-ai-search-depth', 'deep');
                        }}
                        style={{
                          borderRadius: 999,
                          border: aiSearchDepth === 'deep' ? '1px solid #1677ff' : '1px solid #d9d9d9',
                          boxShadow: aiSearchDepth === 'deep' ? '0 0 0 1px rgba(22,119,255,0.2)' : 'none',
                        }}
                      >
                        深度搜索
                      </Button>
                    </div>
                  ) : null}
                  <Button
                    shape="round"
                    size="small"
                    icon={<CodeOutlined />}
                    onClick={() => {
                      const next = !sandboxMode;
                      setSandboxMode(next);
                      localStorage.setItem('kb-sandbox-mode', next ? '1' : '0');
                      if (!next) {
                        setRequestExampleText('');
                        setExampleFileList([]);
                      }
                    }}
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      background: sandboxMode ? '#0d47a1' : '#f1f3f4',
                      color: sandboxMode ? '#fff' : '#5f6368',
                    }}
                  >
                    沙盒
                  </Button>
                  <Button
                    shape="round"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={toggleDocGenMode}
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      background: docGenMode ? '#202124' : '#f1f3f4',
                      color: docGenMode ? '#fff' : '#5f6368',
                    }}
                  >
                    文档生成
                  </Button>
                  <Button
                    shape="round"
                    size="small"
                    disabled={!sandboxMode}
                    onClick={() => setExampleModalOpen(true)}
                  >
                    请求示例
                  </Button>
                  </Space>
                  <Button 
                    type="primary" 
                    shape="circle" 
                    icon={<SendOutlined />} 
                    onClick={ask} 
                    loading={loading} 
                    disabled={!question.trim() || !canAsk}
                  />
                </div>
                {docAttachments.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {docAttachments.map((f) => (
                      <Tag
                        key={f.uid}
                        closable
                        onClose={(e) => {
                          e.preventDefault();
                          removeDocAttachment(f.uid);
                        }}
                        color={f.status === 'done' ? 'blue' : f.status === 'uploading' ? 'processing' : 'error'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        {f.status === 'uploading' ? <Spin size="small" /> : null}
                        {f.name}
                        <span style={{ opacity: 0.7 }}>
                          {f.status === 'uploading' ? '加载中' : f.status === 'done' ? '已就绪' : '失败'}
                        </span>
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  AI 可能会犯错。请核实重要信息。
                </Text>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}

      <Modal
        title="客户请求示例（Daytona 沙盒）"
        open={exampleModalOpen}
        onCancel={() => setExampleModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setExampleModalOpen(false)}>关闭</Button>,
          <Button
            key="ok"
            type="primary"
            disabled={!sandboxMode}
            onClick={() => {
              if (!sandboxMode) {
                message.warning('请先点击「沙盒」开启沙盒排错');
                return;
              }
              if (!requestExampleText.trim()) {
                message.warning('请粘贴或上传请求脚本');
                return;
              }
              setExampleModalOpen(false);
              message.success('已保存请求示例，发送消息时将带入沙盒执行');
            }}
          >
            保存并关闭
          </Button>,
        ]}
        width={720}
        destroyOnClose={false}
      >
        {!sandboxMode ? (
          <Text type="warning">请先在大输入框左下角开启「沙盒」，才能上传或粘贴请求示例（与 AI 搜索开关独立）。</Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space>
              <Button
                icon={<CopyOutlined />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(CURL_EXAMPLE_TEMPLATE);
                    message.success('已复制 Postman 风格 curl 示例');
                  } catch {
                    message.error('复制失败，请手动选择模板文本');
                  }
                }}
              >
                复制 curl 示例
              </Button>
              <Upload
                accept=".sh,.bash,.txt,.http,.json"
                maxCount={1}
                fileList={exampleFileList}
                disabled={!sandboxMode}
                beforeUpload={(file) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    setRequestExampleText(String(reader.result || ''));
                    setExampleFileList([{ uid: file.uid, name: file.name, status: 'done' }]);
                    message.success('已读取文件');
                  };
                  reader.readAsText(file as Blob);
                  return false;
                }}
                onRemove={() => {
                  setExampleFileList([]);
                  return true;
                }}
              >
                <Button icon={<UploadOutlined />} disabled={!sandboxMode}>上传文件</Button>
              </Upload>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              将<strong>原样粘贴</strong> Postman「Copy as cURL」或同类工具导出的多行命令即可；系统写入沙盒后执行{' '}
              <code>bash /tmp/request.sh</code>。<strong>无需</strong>自行加 <code>#!/bin/bash</code>、<code>set -e</code>、
              <code>-w HTTP_CODE</code> 等额外参数，以免与真实请求不一致。勿含交互式命令。
            </Text>
            <TextArea
              rows={14}
              value={requestExampleText}
              onChange={(e) => setRequestExampleText(e.target.value)}
              placeholder="粘贴 Postman / Insomnia 导出的 curl（--location、--header、--data 多行格式）…"
              disabled={!sandboxMode}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
