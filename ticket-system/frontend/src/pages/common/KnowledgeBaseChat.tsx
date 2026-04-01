import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Empty,
  Input,
  List,
  MenuProps,
  Modal,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  createBranch,
  createSession,
  deleteMessage,
  deleteSession,
  clearSession,
  getContracts,
  getRunEvents,
  interruptRun,
  listBranches,
  listCheckpoints,
  listMessages,
  listSessions,
  renameSession,
  replayRun,
  restoreSession,
  streamChat,
} from '../../services/kbChatApi';
import { ChatMessage, Citation, KbEvent, UiPayload } from '../../types/kbChat';
import { renderUiPayload } from '../../components/kb/uiRegistry';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface QueueItem {
  id: string;
  prompt: string;
  state: 'queued' | 'running' | 'done' | 'failed';
}

export default function KnowledgeBaseChat() {
  const [contracts, setContracts] = React.useState<any>(null);
  const [sessions, setSessions] = React.useState<any[]>([]);
  const [sessionId, setSessionId] = React.useState<string>('');
  const [branches, setBranches] = React.useState<any[]>([]);
  const [branchId, setBranchId] = React.useState<string>('main');
  const [messagesList, setMessagesList] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [currentRunId, setCurrentRunId] = React.useState<string>('');
  const [streaming, setStreaming] = React.useState(false);
  const [reasoningSummary, setReasoningSummary] = React.useState('');
  const [reasoningDetail, setReasoningDetail] = React.useState('');
  const [toolStates, setToolStates] = React.useState<any[]>([]);
  const [citations, setCitations] = React.useState<Citation[]>([]);
  const [interruptInfo, setInterruptInfo] = React.useState<any>(null);
  const [checkpoints, setCheckpoints] = React.useState<any[]>([]);
  const [structuredBlocks, setStructuredBlocks] = React.useState<UiPayload[]>([]);
  const [joinedFromSeq, setJoinedFromSeq] = React.useState(1);
  const [stepText, setStepText] = React.useState('空闲');
  const [ttftMs, setTtftMs] = React.useState<number | null>(null);
  const [citationGroup, setCitationGroup] = React.useState<'ALL' | 'Web' | 'KB' | 'Internal'>('ALL');
  const [renameModalOpen, setRenameModalOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState('');

  const init = React.useCallback(async () => {
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
    } catch (e) {
      message.error('初始化知识库对话失败');
    }
  }, []);

  React.useEffect(() => {
    void init();
  }, [init]);

  React.useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      const [bs, msgs] = await Promise.all([listBranches(sessionId), listMessages(sessionId, branchId)]);
      setBranches(bs || []);
      setMessagesList(msgs || []);
    })();
  }, [sessionId, branchId]);

  const addLocalAssistantPlaceholder = () => {
    const id = `assistant_${Date.now()}`;
    setMessagesList((prev) => [...prev, { id, role: 'assistant', content: '', branch_id: branchId, created_at: Date.now() / 1000 }]);
    return id;
  };

  const updateAssistantContent = (id: string, append: string) => {
    setMessagesList((prev) => prev.map((m) => (m.id === id ? { ...m, content: (m.content || '') + append } : m)));
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

  React.useEffect(() => {
    if (!streaming) void runNextFromQueue();
  }, [queue, streaming]);

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
      message.error('流式输出失败');
    } finally {
      setStreaming(false);
    }
  };

  const onSend = async () => {
    if (streaming) {
      enqueue(input);
      setInput('');
      return;
    }
    await submitPrompt();
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
    message.success(`人工操作已提交：${action}`);
  };

  const onLoadCheckpoints = async () => {
    if (!currentRunId) return;
    const cps = await listCheckpoints(currentRunId);
    setCheckpoints(cps || []);
  };

  const onReplay = async (checkpointId: string) => {
    if (!currentRunId) return;
    await replayRun(currentRunId, checkpointId);
    message.success('已提交回放');
  };

  const onRejoin = async () => {
    if (!currentRunId) return;
    const missed = await getRunEvents(currentRunId, joinedFromSeq + 1);
    const assistantId = messagesList.filter((m) => m.role === 'assistant').slice(-1)[0]?.id || '';
    (missed || []).forEach((evt: KbEvent) => {
      if (evt.type === 'token' && !assistantId) return;
      handleEvent(assistantId)(evt);
    });
    message.success(`已重连并补齐 ${missed?.length || 0} 条事件`);
  };

  const sessionMenuItems: MenuProps['items'] = [
    { key: 'rename', label: '重命名会话' },
    { key: 'clear', label: '清空上下文' },
    { key: 'delete', label: '删除会话(软删)' },
    { key: 'restore', label: '恢复会话' },
  ];

  const filteredCitations = citations.filter((c) => (citationGroup === 'ALL' ? true : c.sourceType === citationGroup));

  return (
    <Row gutter={16} style={{ padding: 16, height: '100%' }}>
      <Col span={5}>
        <Card title="会话 / 分支" size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button block onClick={async () => {
              const created = await createSession();
              setSessions((prev) => [created, ...prev]);
              setSessionId(created.id);
            }}>+ 新会话</Button>
            <Segmented
              options={sessions.map((s) => ({ label: s.title || s.id, value: s.id }))}
              value={sessionId}
              onChange={(v) => setSessionId(String(v))}
              style={{ width: '100%' }}
            />
            <Dropdown
              menu={{
                items: sessionMenuItems,
                onClick: async ({ key }) => {
                  if (key === 'rename') {
                    const current = sessions.find((s) => s.id === sessionId);
                    setRenameValue(current?.title || '');
                    setRenameModalOpen(true);
                  }
                  if (key === 'clear') await clearSession(sessionId);
                  if (key === 'delete') await onDeleteSession(sessionId);
                  if (key === 'restore') await restoreSession(sessionId);
                },
              }}
              trigger={['click']}
            >
              <Button>会话管理</Button>
            </Dropdown>
            <Segmented
              options={branches.map((b) => ({ label: b.name || b.id, value: b.id }))}
              value={branchId}
              onChange={(v) => setBranchId(String(v))}
              style={{ width: '100%' }}
            />
            <Badge count={queue.filter((q) => q.state === 'queued').length} showZero>
              <Button block disabled={!queue.length}>消息队列</Button>
            </Badge>
          </Space>
        </Card>
      </Col>

      <Col span={13}>
        <Card
          title="知识库对话"
          extra={<Space><Tag>{stepText}</Tag><Tag color={streaming ? 'processing' : 'success'}>{streaming ? 'Streaming' : 'Idle'}</Tag></Space>}
          style={{ height: '100%' }}
          bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Alert
            type="info"
            showIcon
            message="已在现有前端页面启用：Markdown、Reasoning、Tool Calling、HITL、Branching、Time-travel、Structured Output、Message Queue、Join/Rejoin、Generative UI。"
          />

          <div style={{ flex: 1, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
            {!messagesList.length ? (
              <Empty description="开始提问以生成对话" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {messagesList.filter((m) => !m.deleted).map((m) => (
                  <Card
                    key={m.id}
                    size="small"
                    type="inner"
                    title={`${m.role} · ${m.branch_id}`}
                    extra={
                      <Space>
                        <Button size="small" onClick={() => void onCreateBranch(m.id)}>从此分支</Button>
                        <Button size="small" danger onClick={() => void onDeleteMessage(m.id)}>删除</Button>
                      </Space>
                    }
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || '_生成中_'}</ReactMarkdown>
                  </Card>
                ))}
              </Space>
            )}
          </div>

          <Card size="small" title="思考摘要">
            <Text strong>{reasoningSummary || '暂无摘要'}</Text>
            <Collapse
              size="small"
              items={[
                { key: 'reasoningDetail', label: '展开详细思考', children: <Text type="secondary">{reasoningDetail || '暂无详细思考'}</Text> },
              ]}
            />
          </Card>

          <Collapse
            items={[
              { key: 'tools', label: `工具状态 (${toolStates.length})`, children: <List size="small" dataSource={toolStates} renderItem={(x) => <List.Item>{x.name} · {x.status} · {x.step || '-'}</List.Item>} /> },
              {
                key: 'structured',
                label: `Structured / Generative UI (${structuredBlocks.length})`,
                children: structuredBlocks.length ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {structuredBlocks.map((payload, idx) => renderUiPayload(payload, idx))}
                  </Space>
                ) : (
                  <Text type="secondary">暂无可渲染组件</Text>
                ),
              },
              { key: 'join', label: 'Join/Rejoin 状态', children: <Text>最后序号：{joinedFromSeq}（断线后可从该 seq 续取）; 首 token: {ttftMs ?? '-'} ms</Text> },
            ]}
          />

          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入问题；若消息正在生成会自动进入队列。包含“审批”可触发 HITL 示例。"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
            <Button type="primary" loading={streaming} onClick={() => void onSend()}>发送</Button>
            <Button onClick={() => void onRejoin()} disabled={!currentRunId}>Rejoin</Button>
          </Space.Compact>
        </Card>
      </Col>

      <Col span={6}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Card size="small" title="参考资料">
            <Segmented
              size="small"
              options={[
                { label: '全部', value: 'ALL' },
                { label: 'Web', value: 'Web' },
                { label: 'KB', value: 'KB' },
                { label: 'Internal', value: 'Internal' },
              ]}
              value={citationGroup}
              onChange={(v) => setCitationGroup(v as any)}
              style={{ marginBottom: 8 }}
            />
            {filteredCitations.length ? (
              <List
                size="small"
                dataSource={filteredCitations}
                renderItem={(c) => (
                  <List.Item>
                    <Space direction="vertical" size={1}>
                      {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : <Text>{c.title}</Text>}
                      <Text type="secondary">{c.snippet}</Text>
                      <Text type="secondary">[{c.sourceType}] {typeof c.score === 'number' ? c.score.toFixed(2) : '-'}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无引用" />
            )}
          </Card>

          <Card size="small" title="Time-travel">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button onClick={() => void onLoadCheckpoints()} disabled={!currentRunId}>加载 Checkpoints</Button>
              <List
                size="small"
                dataSource={checkpoints}
                renderItem={(ck: any) => (
                  <List.Item
                    actions={[
                      <Button key="replay" size="small" onClick={() => void onReplay(ck.id)}>回放</Button>,
                    ]}
                  >
                    {ck.name || ck.id}
                  </List.Item>
                )}
              />
            </Space>
          </Card>
        </Space>
      </Col>

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

      {!contracts && <Spin fullscreen />}
      <Modal title="重命名会话" open={renameModalOpen} onCancel={() => setRenameModalOpen(false)} onOk={() => void onRenameSession()}>
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="输入新的会话名称" />
      </Modal>
    </Row>
  );
}

