import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Button, Typography, Space, message, List, Tag, Spin, Avatar, Modal, Upload, Segmented, Select } from 'antd';
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
  const [sandboxStatus, setSandboxStatus] = useState('');
  const [retrievalStatus, setRetrievalStatus] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const [chatHistoryList, setChatHistoryList] = useState<any[]>([]);
  const [aiSearchStreamText, setAiSearchStreamText] = useState('');
  /** 主模型 reasoning / Agent 工具步骤（SSE llm_think），与左侧最终回答正文分离 */
  const [llmThinkText, setLlmThinkText] = useState('');
  const [thinkHistory, setThinkHistory] = useState<ThinkRound[]>([]);
  const [ticketOptions, setTicketOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);
  const llmThinkRef = useRef('');

  const canAsk = useMemo(() => {
    if (isCustomer) return !!verifiedCode;
    return true;
  }, [isCustomer, verifiedCode]);

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
  }, [sessionId]);

  const injectTicketToQuestion = async () => {
    if (!selectedTicketId) return message.warning('请先选择工单');
    setTicketLoading(true);
    try {
      const { data } = await api.get(`/tickets/${selectedTicketId}`);
      const t = data?.ticket || data;
      if (!t) throw new Error('工单不存在');
      const detail = [
        `工单编号: ${t.ticketNumber || t.id || ''}`,
        `状态: ${t.status || ''}`,
        `平台: ${t.platform || ''}`,
        `模型: ${t.modelUsed || ''}`,
        t.framework ? `框架/应用: ${t.framework}` : '',
        t.networkEnv ? `网络环境: ${t.networkEnv}` : '',
        t.accountInfo ? `账号信息: ${t.accountInfo}` : '',
        `问题描述:\n${t.description || ''}`,
        t.requestExample ? `请求示例:\n${t.requestExample}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const prefixed = `请基于以下工单信息协助排查并给出解决建议：\n\n${detail}`;
      setQuestion((prev) => (prev?.trim() ? `${prev}\n\n---\n${prefixed}` : prefixed));
      if (sandboxMode && t.requestExample && !requestExampleText.trim()) {
        setRequestExampleText(String(t.requestExample));
      }
      message.success('工单明细已加载到输入框');
    } catch (e: any) {
      message.error(e?.message || '加载工单明细失败');
    } finally {
      setTicketLoading(false);
    }
  };

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
      const res = await fetchWithAuthStream(apiUrl('/api/knowledge-base/chat/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          message: userMsg.content,
          searchMode,
          ...(searchMode === 'hybrid' ? { aiSearchDepth } : {}),
          ...(sandboxMode && requestExampleText.trim()
            ? { useSandbox: true, requestExample: requestExampleText.trim() }
            : {}),
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
        const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
        const dataLines = lines.filter((l) => l.startsWith('data:'));
        if (!dataLines.length) return;
        const raw = dataLines
          .map((l) => l.replace(/^data:\s?/i, '').trim())
          .join('\n')
          .trim();
        handleSsePayload(raw);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop() || '';
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
                gap: 24,
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
                  flex: 1,
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
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
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
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{llmThinkText}</ReactMarkdown>
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
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.think}</ReactMarkdown>
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

                <div style={{ marginBottom: 24 }}>
                  <Text strong style={{ display: 'block', marginBottom: 12 }}>工单明细</Text>
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="选择工单后可注入对话"
                      optionFilterProp="label"
                      value={selectedTicketId || undefined}
                      options={ticketOptions}
                      onChange={(v) => setSelectedTicketId(v || '')}
                      style={{ width: '100%' }}
                    />
                    <Button size="small" onClick={() => void injectTicketToQuestion()} loading={ticketLoading} disabled={!selectedTicketId}>
                      加载到对话输入框
                    </Button>
                  </Space>
                </div>

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
                    <Segmented
                      size="small"
                      options={[
                        { label: '快速搜索', value: 'quick' },
                        { label: '深度搜索', value: 'deep' },
                      ]}
                      value={aiSearchDepth}
                      onChange={(v) => {
                        const next = v === 'quick' ? 'quick' : 'deep';
                        setAiSearchDepth(next);
                        localStorage.setItem('kb-ai-search-depth', next);
                      }}
                    />
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
