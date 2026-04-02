import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Input, Button, Typography, Space, Avatar, ConfigProvider, theme, Tag, Dropdown, MenuProps, Modal, List, Collapse, Alert, Spin, Segmented, Badge, Tooltip } from 'antd';
import {
  MenuOutlined, PlusOutlined, SearchOutlined, FolderOutlined,
  SendOutlined, SlidersOutlined, DatabaseOutlined, DownOutlined,
  UserOutlined, RobotOutlined, EditOutlined, MessageOutlined, ToolOutlined, BulbOutlined,
  ArrowLeftOutlined, BgColorsOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../../contexts/AuthContext';
import {
  createBranch, createSession, deleteMessage, deleteSession, clearSession,
  getContracts, getRunEvents, interruptRun, listBranches, listCheckpoints,
  listMessages, listSessions, renameSession, replayRun, restoreSession, streamChat
} from '../../../services/kbChatApi';
import { ChatMessage, Citation, KbEvent, UiPayload } from '../../../types/kbChat';
import { renderUiPayload } from '../../../components/kb/uiRegistry';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;

interface QueueItem {
  id: string;
  prompt: string;
  state: 'queued' | 'running' | 'done' | 'failed';
}

export default function KnowledgeBaseChat() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState<string>('main');
  const [messagesList, setMessagesList] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string>('');
  const [streaming, setStreaming] = useState(false);
  
  const [reasoningSummary, setReasoningSummary] = useState('');
  const [reasoningDetail, setReasoningDetail] = useState('');
  const [toolStates, setToolStates] = useState<any[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [interruptInfo, setInterruptInfo] = useState<any>(null);
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [structuredBlocks, setStructuredBlocks] = useState<UiPayload[]>([]);
  const [joinedFromSeq, setJoinedFromSeq] = useState(1);
  const [stepText, setStepText] = useState('Idle');
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [citationGroup, setCitationGroup] = useState<'ALL' | 'Web' | 'KB' | 'Internal'>('ALL');
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [leftSiderCollapsed, setLeftSiderCollapsed] = useState(false);

  // Theme support
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('kb-theme');
    return saved ? saved === 'dark' : true;
  });

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    localStorage.setItem('kb-theme', next ? 'dark' : 'light');
  };

  const bgColor = isDarkMode ? '#000000' : '#f6f8fb';
  const sidebarBg = isDarkMode ? '#1e1f20' : '#ffffff';
  const textColor = isDarkMode ? '#e3e3e3' : '#333333';
  const borderColor = isDarkMode ? '#3c4043' : '#e5e7eb';
  const containerBg = isDarkMode ? '#1e1f20' : '#fbfcfe';
  const userBubbleBg = isDarkMode ? '#282a2c' : '#e6f4ff';
  const userBubbleBorder = isDarkMode ? 'none' : '1px solid #91caff';
  const userBubbleColor = isDarkMode ? '#e3e3e3' : '#000000';
  const accentColor = isDarkMode ? '#a8c7fa' : '#1677ff';
  const headerIconColor = isDarkMode ? '#e3e3e3' : '#5f6368';
  const itemHoverBg = isDarkMode ? '#282a2c' : '#f1f3f4';
  const inputContainerBg = isDarkMode ? '#1e1f20' : '#ffffff';
  const titleColor = isDarkMode ? '#ffffff' : '#000000';

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [initError, setInitError] = useState<string>('');

  const init = useCallback(async () => {
    try {
      const [ctr, sess] = await Promise.all([getContracts(), listSessions()]);
      setContracts(ctr);
      setSessions(sess || []);
      if (sess?.length) {
        setSessionId(sess[0].id);
      } else {
        const created = await createSession();
        setSessionId(created.id);
        setSessions([created]);
      }
    } catch (e: any) {
      setInitError(e?.message || '未知网络错误');
      // @ts-ignore
      message.error(`初始化失败: ${e?.message || '请检查控制台网络请求'}`);
      setContracts({ events: [] }); // 兜底解除 Spin
    }
  }, []);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      const [bs, msgs] = await Promise.all([listBranches(sessionId), listMessages(sessionId, branchId)]);
      setBranches(bs || []);
      setMessagesList(msgs || []);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    })();
  }, [sessionId, branchId]);

  const addLocalAssistantPlaceholder = () => {
    const id = `assistant_${Date.now()}`;
    setMessagesList((prev) => [...prev, { id, role: 'assistant', content: '', branch_id: branchId, created_at: Date.now() / 1000 }]);
    return id;
  };

  const updateAssistantContent = (id: string, append: string) => {
    setMessagesList((prev) => prev.map((m) => (m.id === id ? { ...m, content: (m.content || '') + append } : m)));
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const enqueue = (prompt: string) => {
    setQueue((prev) => [...prev, { id: `q_${Date.now()}`, prompt, state: 'queued' }]);
  };

  const runNextFromQueue = async () => {
    const next = queue.find((item) => item.state === 'queued');
    if (!next || streaming) return;
    setQueue((prev) => prev.map((i) => (i.id === next.id ? { ...i, state: 'running' } : i)));
    await submitPrompt(next.prompt);
    setQueue((prev) => prev.map((i) => (i.id === next.id ? { ...i, state: 'done' } : i)));
  };

  useEffect(() => { if (!streaming) void runNextFromQueue(); }, [queue, streaming]);

  const handleEvent = (assistantId: string) => (evt: KbEvent) => {
    setCurrentRunId(evt.run_id);
    setJoinedFromSeq(evt.seq);
    if (evt.type === 'message_start') {
      setStepText('已开始响应');
      setTtftMs(null);
    }
    if (evt.type === 'token') {
      updateAssistantContent(assistantId, evt.payload?.text || '');
      if (!ttftMs) setTtftMs(Math.max(1, Math.round((Date.now() - Number((assistantId.split('_')[1] || Date.now()))) / 1)));
    }
    if (evt.type === 'reasoning_summary') {
      setReasoningSummary(evt.payload?.summary || '');
      setReasoningDetail(evt.payload?.detail || '');
    }
    if (evt.type === 'tool_status') {
      setToolStates((prev) => [...prev, evt.payload]);
      if (evt.payload?.step) setStepText(evt.payload.step);
    }
    if (evt.type === 'citation') {
      setCitations(evt.payload?.items || []);
    }
    if (evt.type === 'interrupt') {
      setInterruptInfo(evt.payload);
    }
    if (evt.type === 'checkpoint') {
      setCheckpoints((prev) => [...prev, evt.payload]);
    }
    if (evt.type === 'ui_payload') {
      setStructuredBlocks((prev) => [...prev, evt.payload as UiPayload]);
    }
    if (evt.type === 'message_end') {
      setStepText('已完成');
      if (evt.payload?.metrics?.ttft_ms) setTtftMs(evt.payload.metrics.ttft_ms);
    }
    if (evt.type === 'error') {
      setStepText('发生错误');
    }
  };

  const submitPrompt = async (promptRaw?: string) => {
    const prompt = (promptRaw ?? input).trim();
    if (!prompt || !sessionId) return;
    setInput('');
    setStreaming(true);
    setReasoningSummary('');
    setReasoningDetail('');
    setToolStates([]);
    setCitations([]);
    setStructuredBlocks([]);
    setInterruptInfo(null);
    setStepText('排队中');
    setTtftMs(null);
    const assistantId = addLocalAssistantPlaceholder();

    try {
      await streamChat({ session_id: sessionId, prompt, branch_id: branchId, metadata: { mode: 'full-capability' } }, handleEvent(assistantId));
    } catch (e) {
      // ignore
    } finally {
      setStreaming(false);
    }
  };

  const handleSend = () => {
    if (streaming) {
      enqueue(input);
      setInput('');
      return;
    }
    void submitPrompt();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onNewSession = async () => {
    const created = await createSession();
    setSessions((prev) => [created, ...prev]);
    setSessionId(created.id);
  };

  const onDeleteSession = async (sid: string) => {
    await deleteSession(sid);
    const next = (await listSessions()) || [];
    setSessions(next);
    if (next.length) setSessionId(next[0].id);
    else {
      const created = await createSession();
      setSessions([created]);
      setSessionId(created.id);
    }
  };

  const onRenameSession = async () => {
    if (!sessionId || !renameValue.trim()) return;
    await renameSession(sessionId, renameValue.trim());
    const next = (await listSessions()) || [];
    setSessions(next);
    setRenameModalOpen(false);
    setRenameValue('');
  };

  const onDeleteMessage = async (mid: string) => {
    await deleteMessage(mid);
    setMessagesList((prev) => prev.filter((m) => m.id !== mid));
  };

  const onCreateBranch = async (fromMessageId: string) => {
    const b = await createBranch(sessionId, fromMessageId);
    setBranches((prev) => [...prev, b]);
    setBranchId(b.id);
  };

  const onInterruptAction = async (action: 'approve' | 'reject' | 'resume') => {
    if (!currentRunId) return;
    await interruptRun(currentRunId, action);
    setInterruptInfo(null);
  };

  const onLoadCheckpoints = async () => {
    if (!currentRunId) return;
    const cps = await listCheckpoints(currentRunId);
    setCheckpoints(cps || []);
  };

  const onReplay = async (checkpointId: string) => {
    if (!currentRunId) return;
    await replayRun(currentRunId, checkpointId);
  };

  const onRejoin = async () => {
    if (!currentRunId) return;
    const missed = await getRunEvents(currentRunId, joinedFromSeq + 1);
    const assistantId = messagesList.filter((m) => m.role === 'assistant').slice(-1)[0]?.id || '';
    (missed || []).forEach((evt: KbEvent) => {
      if (evt.type === 'token' && !assistantId) return;
      handleEvent(assistantId)(evt);
    });
  };

  const sessionMenuItems: MenuProps['items'] = [
    { key: 'rename', label: 'Rename Session' },
    { key: 'clear', label: 'Clear Context' },
    { key: 'delete', label: 'Delete Session', danger: true },
    { key: 'restore', label: 'Restore Session' },
  ];

  const filteredCitations = citations.filter((c) => (citationGroup === 'ALL' ? true : c.sourceType === citationGroup));

  if (!contracts) return <Spin fullscreen />;

  return (
    <ConfigProvider theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorBgBase: bgColor, colorTextBase: textColor, colorBorder: borderColor } }}>
      <Layout style={{ height: '100vh', display: 'flex', flexDirection: 'row', overflow: 'hidden', background: bgColor }}>
        <Sider collapsed={leftSiderCollapsed} collapsedWidth={0} width={280} style={{ background: sidebarBg, padding: leftSiderCollapsed ? 0 : '16px 12px', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${borderColor}` }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, padding: '0 12px' }}>
            <Button type="text" icon={<MenuOutlined />} onClick={() => setLeftSiderCollapsed(!leftSiderCollapsed)} style={{ color: headerIconColor, marginRight: 16 }} />
            <span style={{ fontSize: 18, fontWeight: 500, color: titleColor }}>Agent <Tag color="blue" style={{ borderRadius: 12, marginLeft: 8, background: isDarkMode ? '#1c2b41' : '#e6f4ff', color: accentColor, border: 'none' }}>KB</Tag></span>
          </div>

          <Button type="text" icon={<EditOutlined />} onClick={onNewSession} style={{ color: headerIconColor, justifyContent: 'flex-start', marginBottom: 8, height: 40, borderRadius: 20 }}>
            New chat
          </Button>
          <Button type="text" icon={<SearchOutlined />} style={{ color: headerIconColor, justifyContent: 'flex-start', marginBottom: 8, height: 40, borderRadius: 20 }}>
            Search
          </Button>

          <div style={{ padding: '0 12px', fontSize: 12, color: isDarkMode ? '#a0a0a0' : '#5f6368', marginBottom: 8, marginTop: 24, fontWeight: 600 }}>Branches</div>
          <Segmented
            options={branches.map((b) => ({ label: b.name || b.id, value: b.id }))}
            value={branchId}
            onChange={(v) => setBranchId(String(v))}
            style={{ width: '100%', marginBottom: 16, background: itemHoverBg }}
          />

          <div style={{ padding: '0 12px', fontSize: 12, color: isDarkMode ? '#a0a0a0' : '#5f6368', marginTop: 8, marginBottom: 8, fontWeight: 600 }}>Chats</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessions.map((s) => (
              <Dropdown
                key={s.id}
                menu={{
                  items: sessionMenuItems,
                  onClick: async ({ key }) => {
                    if (key === 'rename') {
                      setRenameValue(s.title || '');
                      setRenameModalOpen(true);
                    }
                    if (key === 'clear') await clearSession(s.id);
                    if (key === 'delete') await onDeleteSession(s.id);
                    if (key === 'restore') await restoreSession(s.id);
                  },
                }}
                trigger={['contextMenu']}
              >
                <Button 
                  type="text" 
                  icon={<MessageOutlined />} 
                  onClick={() => setSessionId(s.id)}
                  style={{ 
                    color: s.id === sessionId ? accentColor : headerIconColor, 
                    background: s.id === sessionId ? (isDarkMode ? '#1c2b41' : '#e6f4ff') : 'transparent',
                    justifyContent: 'flex-start', 
                    width: '100%', 
                    height: 40, 
                    borderRadius: 20, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap' 
                  }}>
                  {s.title || s.id}
                </Button>
              </Dropdown>
            ))}
          </div>
        </Sider>

        <Content style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', flex: 1, background: bgColor }}>
          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10 }}>
            <Space>
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => window.history.back()} style={{ color: headerIconColor, background: sidebarBg, borderRadius: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                返回工单系统
              </Button>
              {leftSiderCollapsed && <Button type="text" icon={<MenuOutlined />} onClick={() => setLeftSiderCollapsed(false)} style={{ color: headerIconColor, background: sidebarBg, borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />}
            </Space>
          </div>
          <div style={{ position: 'absolute', top: 16, right: 24, zIndex: 10 }}>
            <Space>
              <Button type="text" icon={<BgColorsOutlined />} onClick={toggleTheme} style={{ color: headerIconColor, background: sidebarBg, borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} title="Toggle Theme" />
              <Badge count={queue.filter((q) => q.state === 'queued').length} size="small"><Button type="text" style={{ color: headerIconColor }}>Queue</Button></Badge>
              <Tag color={streaming ? (isDarkMode ? '#1c2b41' : '#e6f4ff') : (isDarkMode ? '#3c4043' : '#f0f0f0')} style={{ border: 'none', color: streaming ? accentColor : headerIconColor, borderRadius: 12 }}>{stepText}</Tag>
              {ttftMs && <Tag color={isDarkMode ? '#3c4043' : '#f0f0f0'} style={{ border: 'none', color: headerIconColor, borderRadius: 12 }}>TTFT: {ttftMs}ms</Tag>}
              <Avatar icon={<UserOutlined />} src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" />
            </Space>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '40px 10%', display: 'flex', flexDirection: 'column' }}>
            {messagesList.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 800 }}>
                <Title level={2} style={{ color: titleColor, fontWeight: 400 }}>
                  <span style={{ color: accentColor }}>✦</span> Hello, {user?.username || 'User'}
                </Title>
                <Title level={1} style={{ color: titleColor, fontSize: 48, fontWeight: 400, marginTop: 0 }}>
                  WBChat Agent
                </Title>
                <Alert type="info" message="已集成：12项流式标准能力，支持明暗主题切换以及工单系统返回按钮。" style={{ background: containerBg, border: `1px solid ${borderColor}`, color: textColor, marginTop: 24, borderRadius: 12 }} />
                {initError && <Alert type="error" message={`后端连接失败: ${initError}`} style={{ marginTop: 16, borderRadius: 12 }} />}
              </div>
            ) : (
              <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', paddingBottom: 150 }}>
                {messagesList.filter((m) => !m.deleted).map((m, i) => {
                  if (m.role === 'user') {
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
                        <div style={{ background: userBubbleBg, border: userBubbleBorder, padding: '12px 20px', borderRadius: '24px 24px 4px 24px', maxWidth: '80%', color: userBubbleColor, fontSize: 16 }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                          <div style={{ textAlign: 'right', marginTop: 8 }}>
                            <Tooltip title="Branch from here">
                              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => void onCreateBranch(m.id)} style={{ color: isDarkMode ? '#888' : '#5f6368' }} />
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    const isLast = i === messagesList.length - 1;
                    return (
                      <div key={m.id} style={{ display: 'flex', marginBottom: 32, alignItems: 'flex-start' }}>
                        <Avatar icon={<RobotOutlined />} style={{ background: accentColor, color: isDarkMode ? '#000' : '#fff', marginRight: 16, flexShrink: 0 }} />
                        <div style={{ color: textColor, fontSize: 16, lineHeight: 1.6, flex: 1, overflow: 'hidden' }}>
                          
                          {/* Reasonings and Tools (Only show for the active/latest generation, or attach to message if stored) */}
                          {isLast && (reasoningSummary || toolStates.length > 0) && (
                            <div style={{ marginBottom: 16, background: containerBg, padding: 16, borderRadius: 16, border: `1px solid ${borderColor}` }}>
                              {reasoningSummary && (
                                <Collapse
                                  size="small"
                                  ghost
                                  expandIconPosition="end"
                                  items={[{ 
                                    key: '1', 
                                    label: <Space><BulbOutlined style={{ color: accentColor }} /> <Text style={{ color: textColor }}>{reasoningSummary}</Text></Space>, 
                                    children: <Text type="secondary" style={{ color: isDarkMode ? '#a0a0a0' : '#5f6368' }}>{reasoningDetail || 'No details.'}</Text> 
                                  }]}
                                />
                              )}
                              {toolStates.length > 0 && (
                                <Collapse
                                  size="small"
                                  ghost
                                  expandIconPosition="end"
                                  items={[{ 
                                    key: '2', 
                                    label: <Space><ToolOutlined style={{ color: accentColor }} /> <Text style={{ color: textColor }}>Tools ({toolStates.length})</Text></Space>, 
                                    children: <List size="small" dataSource={toolStates} renderItem={(x) => <List.Item style={{ color: isDarkMode ? '#a0a0a0' : '#5f6368', borderBottom: 'none', padding: '4px 0' }}>{x.name} · {x.status} {x.step ? `· ${x.step}` : ''}</List.Item>} /> 
                                  }]}
                                />
                              )}
                            </div>
                          )}

                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {m.content || '...'}
                          </ReactMarkdown>

                          {/* Generative UI & Citations for the latest generation */}
                          {isLast && structuredBlocks.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <Space direction="vertical" style={{ width: '100%' }}>
                                {structuredBlocks.map((payload, idx) => renderUiPayload(payload, idx))}
                              </Space>
                            </div>
                          )}

                          {isLast && citations.length > 0 && (
                            <div style={{ marginTop: 16, background: containerBg, padding: 16, borderRadius: 16, border: `1px solid ${borderColor}` }}>
                              <Text strong style={{ color: titleColor, marginBottom: 8, display: 'block' }}>Sources</Text>
                              <Segmented
                                size="small"
                                options={[{ label: 'ALL', value: 'ALL' }, { label: 'Web', value: 'Web' }, { label: 'KB', value: 'KB' }, { label: 'Internal', value: 'Internal' }]}
                                value={citationGroup}
                                onChange={(v) => setCitationGroup(v as any)}
                                style={{ marginBottom: 12, background: itemHoverBg }}
                              />
                              <List
                                size="small"
                                dataSource={filteredCitations}
                                renderItem={(c) => (
                                  <List.Item style={{ borderBottom: `1px solid ${borderColor}` }}>
                                    <Space direction="vertical" size={2}>
                                      {c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: accentColor }}>{c.title}</a> : <Text style={{ color: accentColor }}>{c.title}</Text>}
                                      <Text style={{ color: isDarkMode ? '#a0a0a0' : '#5f6368', fontSize: 13 }}>{c.snippet}</Text>
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            </div>
                          )}

                          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                            <Button type="text" size="small" onClick={() => void onDeleteMessage(m.id)} style={{ color: isDarkMode ? '#888' : '#5f6368' }}>Delete</Button>
                            {isLast && currentRunId && (
                              <>
                                <Button type="text" size="small" onClick={() => void onLoadCheckpoints()} style={{ color: isDarkMode ? '#888' : '#5f6368' }}>Checkpoints</Button>
                                <Button type="text" size="small" onClick={() => void onRejoin()} style={{ color: isDarkMode ? '#888' : '#5f6368' }}>Rejoin</Button>
                              </>
                            )}
                          </div>

                          {/* Checkpoints UI if loaded */}
                          {isLast && checkpoints.length > 0 && (
                            <div style={{ marginTop: 8, padding: 8, background: containerBg, borderRadius: 8, border: `1px solid ${borderColor}` }}>
                              <List
                                size="small"
                                dataSource={checkpoints}
                                renderItem={(ck: any) => (
                                  <List.Item actions={[<Button type="link" size="small" onClick={() => void onReplay(ck.id)}>Replay</Button>]}>
                                    <Text style={{ color: textColor }}>{ck.name || ck.id}</Text>
                                  </List.Item>
                                )}
                              />
                            </div>
                          )}

                        </div>
                      </div>
                    );
                  }
                })}
                <div ref={messagesEndRef} style={{ height: 1 }} />
              </div>
            )}
          </div>

          <div style={{ padding: '0 10%', paddingBottom: 32, position: 'absolute', bottom: 0, width: '100%', background: `linear-gradient(to top, ${bgColor} 70%, transparent)` }}>
            <div style={{ maxWidth: 900, margin: '0 auto', background: inputContainerBg, borderRadius: 32, padding: '12px 16px', display: 'flex', flexDirection: 'column', border: `1px solid ${borderColor}`, boxShadow: isDarkMode ? 'none' : '0 4px 12px rgba(0,0,0,0.05)' }}>
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything, search your data, @mention or /tools"
                autoSize={{ minRows: 1, maxRows: 6 }}
                style={{ background: 'transparent', color: textColor, fontSize: 16, boxShadow: 'none', border: 'none', resize: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <Space size={16}>
                  <Button type="text" icon={<PlusOutlined />} style={{ color: headerIconColor, borderRadius: '50%' }} />
                  <Button type="text" icon={<SlidersOutlined />} style={{ color: headerIconColor, borderRadius: '50%' }} />
                  <Button type="text" icon={<DatabaseOutlined />} style={{ color: headerIconColor, borderRadius: '50%' }} />
                </Space>
                <Space>
                  <Button type="text" style={{ color: accentColor, background: itemHoverBg, borderRadius: 20 }}>
                    WBChat Agent <DownOutlined style={{ fontSize: 10 }} />
                  </Button>
                  <Button 
                    type={input.trim() ? "primary" : "text"} 
                    icon={<SendOutlined />} 
                    onClick={handleSend}
                    loading={streaming}
                    style={{ 
                      borderRadius: '50%', 
                      background: input.trim() ? accentColor : 'transparent', 
                      color: input.trim() ? (isDarkMode ? '#000' : '#fff') : headerIconColor,
                      borderColor: 'transparent'
                    }} 
                  />
                </Space>
              </div>
            </div>
          </div>
        </Content>

        <Modal
          title="Human-in-the-loop"
          open={!!interruptInfo}
          onCancel={() => setInterruptInfo(null)}
          footer={[
            <Button key="reject" danger onClick={() => void onInterruptAction('reject')}>Reject</Button>,
            <Button key="approve" type="primary" onClick={() => void onInterruptAction('approve')}>Approve</Button>,
          ]}
        >
          <Space direction="vertical">
            <Text strong>{interruptInfo?.title || '需要人工确认'}</Text>
            <Text>{interruptInfo?.description || ''}</Text>
          </Space>
        </Modal>

        <Modal title="Rename Session" open={renameModalOpen} onCancel={() => setRenameModalOpen(false)} onOk={() => void onRenameSession()}>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Session name" />
        </Modal>

      </Layout>
    </ConfigProvider>
  );
}
