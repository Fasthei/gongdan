import React, { useMemo, useState } from 'react';
import { Card, Input, Button, Typography, Space, message, List, Tag, Spin } from 'antd';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const { TextArea } = Input;
const { Title, Text } = Typography;

type ChatItem = { role: 'user' | 'assistant'; content: string; searchMode?: 'internal' | 'hybrid' };

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
  const [usedSearchMode, setUsedSearchMode] = useState<'internal' | 'hybrid'>('internal');

  const canAsk = useMemo(() => {
    if (isCustomer) return !!verifiedCode;
    return true;
  }, [isCustomer, verifiedCode]);

  const verifyCode = () => {
    if (!customerCode.trim()) return message.warning('请先输入客户编号');
    setVerifiedCode(customerCode.trim());
    message.success('客户编号已确认，可以开始知识库对话');
  };

  const ask = async () => {
    if (!question.trim()) return;
    if (!canAsk) return message.warning('客户请先输入并确认客户编号');

    const userMsg: ChatItem = { role: 'user', content: question.trim(), searchMode };
    const nextChat = [...chat, userMsg];
    setChat(nextChat);
    localStorage.setItem('kb-chat-history', JSON.stringify(nextChat));
    setQuestion('');
    setLoading(true);

    try {
      const { data } = await api.post('/knowledge-base/chat', {
        sessionId: sessionId || undefined,
        message: userMsg.content,
        searchMode,
        ...(isCustomer ? { customerCode: verifiedCode } : {}),
      });
      const answer = data?.answer || '未获取到答案';
      const roundMode: 'internal' | 'hybrid' = data?.usedSearchMode === 'hybrid' ? 'hybrid' : 'internal';
      const merged = [...nextChat, { role: 'assistant', content: answer, searchMode: roundMode } as ChatItem];
      setChat(merged);
      localStorage.setItem('kb-chat-history', JSON.stringify(merged));
      if (data?.sessionId) {
        setSessionId(data.sessionId);
        localStorage.setItem('kb-chat-session-id', data.sessionId);
      }
      setSources(Array.isArray(data?.sources) ? data.sources : []);
      setFollowUps(Array.isArray(data?.followUps) ? data.followUps : []);
      setUsedSearchMode(data?.usedSearchMode === 'hybrid' ? 'hybrid' : 'internal');
    } catch (err: any) {
      message.error(err.response?.data?.message || '知识库对话失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Title level={4}>知识库对话</Title>
      {isCustomer && (
        <Space style={{ marginBottom: 12 }}>
          <Input
            value={customerCode}
            onChange={(e) => setCustomerCode(e.target.value)}
            placeholder="请输入客户编号（必填）"
            style={{ width: 280 }}
          />
          <Button onClick={verifyCode}>确认编号</Button>
          {verifiedCode && <Tag color="green">已确认：{verifiedCode}</Tag>}
        </Space>
      )}

      <List
        dataSource={chat}
        locale={{ emptyText: '开始提问，进行知识库对话' }}
        renderItem={(item) => (
          <List.Item>
            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '75%',
                  background: item.role === 'user' ? '#1677ff' : '#f5f5f5',
                  color: item.role === 'user' ? '#fff' : '#000',
                  borderRadius: 12,
                  padding: '10px 12px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                <Text style={{ color: item.role === 'user' ? '#fff' : '#000' }}>{item.content}</Text>
                {item.searchMode && (
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                    {item.searchMode === 'hybrid' ? '内部 + 外部' : '仅内部'}
                  </div>
                )}
              </div>
            </div>
          </List.Item>
        )}
        style={{ marginBottom: 12, maxHeight: 360, overflow: 'auto' }}
      />

      <TextArea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="输入问题后发送..."
      />
      <Space style={{ marginTop: 12 }}>
        <Button
          onClick={() => {
            const next = searchMode === 'internal' ? 'hybrid' : 'internal';
            setSearchMode(next);
            localStorage.setItem('kb-chat-search-mode', next);
          }}
        >
          {searchMode === 'hybrid' ? '已启用外部搜索' : '仅内部知识库'}
        </Button>
        <Button type="primary" onClick={ask} loading={loading} disabled={!canAsk}>
          发送
        </Button>
        <Button
          onClick={() => {
            setChat([]);
            setSources([]);
            setFollowUps([]);
            setSessionId('');
            localStorage.removeItem('kb-chat-history');
            localStorage.removeItem('kb-chat-session-id');
          }}
        >
          清空会话
        </Button>
      </Space>
      <div style={{ marginTop: 8 }}>
        <Text type="secondary">
          本轮来源：{usedSearchMode === 'hybrid' ? '内部知识库 + 外部搜索' : '仅内部知识库'}
        </Text>
      </div>
      {loading && (
        <div style={{ marginTop: 10 }}>
          <Spin size="small" /> <Text type="secondary">正在思考中...</Text>
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Text strong>参考资料：</Text>
          <List
            size="small"
            dataSource={sources}
            renderItem={(s: any) => (
              <List.Item>
                <Text>{s.title || '未命名资料'} {s.platform ? `(${s.platform})` : ''}</Text>
              </List.Item>
            )}
          />
        </div>
      )}

      {followUps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong>推荐追问：</Text>
          <Space wrap style={{ marginTop: 6 }}>
            {followUps.map((f, i) => (
              <Button key={`${i}-${f}`} size="small" onClick={() => setQuestion(f)}>
                {f}
              </Button>
            ))}
          </Space>
        </div>
      )}
    </Card>
  );
}
