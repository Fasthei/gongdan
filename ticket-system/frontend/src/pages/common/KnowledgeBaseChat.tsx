import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Button, Typography, Space, message, List, Tag, Spin, Avatar, Segmented } from 'antd';
import { RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  const messagesRef = useRef<HTMLDivElement | null>(null);

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
            setChat(data);
            localStorage.setItem('kb-chat-history', JSON.stringify(data));
          }
        })
        .catch(() => {
          // 忽略错误，降级使用本地缓存
        });
    }
  }, [sessionId]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chat, loading]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', background: '#fff', margin: '-24px' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => window.history.back()} />
          <Title level={5} style={{ margin: 0 }}>知识库对话</Title>
        </Space>
        <Space>
          <Segmented<'internal' | 'hybrid'>
            value={searchMode}
            options={[
              { label: '仅内部', value: 'internal' },
              { label: '内部+外部', value: 'hybrid' },
            ]}
            onChange={(val) => {
              setSearchMode(val);
              localStorage.setItem('kb-chat-search-mode', val);
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setChat([]);
              setSources([]);
              setFollowUps([]);
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
        <>
          {/* Messages Area */}
          <div ref={messagesRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 0', scrollBehavior: 'smooth', overflowX: 'hidden' }}>
            <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
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
                          marginTop: 4
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
                              {item.searchMode === 'hybrid' ? '检索来源: 内部 + 外部' : '检索来源: 仅内部'}
                            </Tag>
                          </div>
                        )}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
              {loading && (
                <div style={{ padding: '16px 0', display: 'flex', gap: 16 }}>
                  <Avatar icon={<RobotOutlined />} style={{ background: '#10a37f', flex: '0 0 auto' }} />
                  <div style={{ paddingTop: 6 }}>
                    <Spin size="small" /> <Text type="secondary" style={{ marginLeft: 8 }}>正在思考并检索...</Text>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Input Area */}
          <div style={{ padding: '0 24px 24px', background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 20%)' }}>
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              {sources.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>参考资料</Text>
                  <Space wrap size={[0, 8]}>
                    {sources.map((s: any, idx) => (
                      <Tag key={idx} bordered={false} style={{ background: '#f1f3f4', borderRadius: 12, padding: '2px 10px' }}>
                        {s.title || '未命名资料'}{s.platform ? ` (${s.platform})` : ''}
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}

              {followUps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Space wrap size={[8, 8]}>
                    {followUps.map((f, i) => (
                      <Button key={`${i}-${f}`} size="small" shape="round" onClick={() => setQuestion(f)}>
                        {f}
                      </Button>
                    ))}
                  </Space>
                </div>
              )}

              <div style={{ 
                position: 'relative', 
                boxShadow: '0 2px 6px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.05)', 
                borderRadius: 24,
                background: '#fff',
                padding: '8px 16px'
              }}>
                <TextArea
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="给知识库发送消息..."
                  bordered={false}
                  style={{ paddingRight: 40, resize: 'none', boxShadow: 'none' }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                />
                <Button 
                  type="primary" 
                  shape="circle" 
                  icon={<SendOutlined />} 
                  onClick={ask} 
                  loading={loading} 
                  disabled={!question.trim() || !canAsk}
                  style={{ position: 'absolute', right: 8, bottom: 8 }}
                />
              </div>
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  AI 可能会犯错。请核实重要信息。
                </Text>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
