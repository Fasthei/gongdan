import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Button, Typography, Space, message, List, Tag, Spin, Avatar } from 'antd';
import { RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined, ArrowLeftOutlined, PlusOutlined, GlobalOutlined } from '@ant-design/icons';
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

  const [chatHistoryList, setChatHistoryList] = useState<any[]>([]);

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

    // 尝试拉取用户的历史会话列表
    api.get('/knowledge-base/chat/sessions/list')
      .then(({ data }) => {
        if (Array.isArray(data)) {
          setChatHistoryList(data);
        }
      })
      .catch(() => {});
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
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
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

          {/* Main Chat Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {/* Messages Area */}
            <div ref={messagesRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 0', scrollBehavior: 'smooth', overflowX: 'hidden' }}>
            <div style={{ display: 'flex', maxWidth: 1200, margin: '0 auto', gap: 24, padding: '0 24px' }}>
              {/* Main Chat Stream */}
              <div style={{ flex: 1, maxWidth: 800 }}>
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
                                {item.searchMode === 'hybrid' ? '检索来源: AI 搜索' : '检索来源: 内部知识库'}
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

              {/* Right Sidebar for Sources & Follow-ups */}
              <div style={{ width: 300, flexShrink: 0, display: chat.length > 0 || loading ? 'block' : 'none' }}>
                {loading && (
                  <div style={{ marginBottom: 24, padding: 16, background: '#f8f9fa', borderRadius: 12 }}>
                    <Text strong style={{ display: 'block', marginBottom: 12 }}>思考状态</Text>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 13 }}><Spin size="small" style={{ marginRight: 8 }} /> 分析问题中...</Text>
                      {usedSearchMode === 'hybrid' && <Text type="secondary" style={{ fontSize: 13 }}><Spin size="small" style={{ marginRight: 8 }} /> 调用 AI 搜索 Agent...</Text>}
                      <Text type="secondary" style={{ fontSize: 13 }}><Spin size="small" style={{ marginRight: 8 }} /> 检索内部知识库...</Text>
                    </Space>
                  </div>
                )}

                {sources.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <Text strong style={{ display: 'block', marginBottom: 12 }}>参考资料</Text>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      {sources.map((s: any, idx) => (
                        <div key={idx} style={{ background: '#f1f3f4', padding: '8px 12px', borderRadius: 8 }}>
                          <Text style={{ fontSize: 13, display: 'block', fontWeight: 500 }} ellipsis={{ tooltip: s.title }}>
                            {s.title || '未命名资料'}
                          </Text>
                          {s.platform && <Text type="secondary" style={{ fontSize: 12 }}>来源: {s.platform}</Text>}
                        </div>
                      ))}
                    </Space>
                  </div>
                )}

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
          </div>

          {/* Input Area */}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'absolute', bottom: 8, left: 16, right: 8 }}>
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
    </div>
  );
}
