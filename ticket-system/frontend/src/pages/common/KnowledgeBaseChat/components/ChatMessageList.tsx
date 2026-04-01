import React from 'react';
import { Button, Typography, Space, List, Tag, Spin, Avatar, Modal, Upload, Select, Tooltip, Input, message, Collapse, Badge } from 'antd';
import { 
  RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined, ArrowLeftOutlined, 
  PlusOutlined, GlobalOutlined, CodeOutlined, CopyOutlined, UploadOutlined, 
  InfoCircleOutlined, DownloadOutlined, DeleteOutlined, CheckCircleOutlined, SyncOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { KbChatContextType } from '../useKbChat';

import { useAuiState, useAui, MessageByIndexProvider } from '@assistant-ui/react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { TextArea } = Input;

function ChatMessageItem({ idx, markdownComponents, setQuestion }: { idx: number, markdownComponents: any, setQuestion: (q: string) => void }) {
  const aui = useAui();
  const msg = useAuiState((s) => s.message);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const role = msg.role;
  const content = (msg.content.find((c: any) => c.type === 'text') as any)?.text || '';
  const searchMode = msg.metadata?.custom?.searchMode;
  
  return (
    <List.Item style={{ padding: '16px 0' }}>
      <div style={{ width: '100%', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Avatar
          icon={role === 'user' ? <UserOutlined /> : <RobotOutlined />}
          style={{
            background: role === 'user' ? '#1a73e8' : '#10a37f',
            flex: '0 0 auto',
            marginTop: 4,
          }}
        />
        <div style={{ width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ fontWeight: 500, color: '#202124' }}>
              {role === 'user' ? '您' : '知识库助手'}
            </div>
            {msg.branchCount > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', background: '#f1f3f4', borderRadius: 12, padding: '2px 8px', fontSize: 12 }}>
                <Button 
                  type="text" 
                  size="small" 
                  icon={<LeftOutlined style={{ fontSize: 10 }} />} 
                  disabled={msg.branchNumber === 1}
                  onClick={() => aui.message().switchToBranch({ position: 'previous' })}
                  style={{ padding: 0, width: 20, height: 20, minWidth: 20 }}
                />
                <span style={{ margin: '0 4px', color: '#5f6368' }}>{msg.branchNumber} / {msg.branchCount}</span>
                <Button 
                  type="text" 
                  size="small" 
                  icon={<RightOutlined style={{ fontSize: 10 }} />} 
                  disabled={msg.branchNumber === msg.branchCount}
                  onClick={() => aui.message().switchToBranch({ position: 'next' })}
                  style={{ padding: 0, width: 20, height: 20, minWidth: 20 }}
                />
              </div>
            )}
          </div>
          <div className="message-parts" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {msg.content.map((part: any, i: number) => {
              if (part.type === 'reasoning') {
                return (
                  <Collapse
                    key={i}
                    size="small"
                    ghost
                    items={[
                      {
                        key: '1',
                        label: <span style={{ color: '#666', fontSize: 13 }}>思考过程</span>,
                        children: (
                          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#666', background: '#f5f5f5', padding: 12, borderRadius: 8 }}>
                            {part.text}
                          </div>
                        ),
                      },
                    ]}
                  />
                );
              }
              if (part.type === 'tool-call') {
                const isToolRunning = part.result === undefined;
                return (
                  <div key={i} style={{ 
                    background: '#f8f9fa', 
                    border: '1px solid #e8eaed', 
                    borderRadius: 8, 
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: '#5f6368',
                    width: 'fit-content'
                  }}>
                    {isToolRunning ? <SyncOutlined spin /> : <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                    <span style={{ fontWeight: 500 }}>{part.toolName}</span>
                    <span style={{ opacity: 0.8 }}>{part.args?.status || (isToolRunning ? '执行中...' : '已完成')}</span>
                  </div>
                );
              }
              if (part.type === 'text') {
                return (
                  <div key={i} className="markdown-body" style={{ color: '#3c4043', fontSize: 15, lineHeight: 1.6, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    {role === 'user' ? (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{part.text}</div>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {part.text}
                      </ReactMarkdown>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            {!!searchMode && (
              <Tag bordered={false} color="default" style={{ fontSize: 12, borderRadius: 4, margin: 0 }}>
                {searchMode === 'hybrid' ? '检索来源: AI 搜索' : '检索来源: 内部知识库'}
              </Tag>
            )}
            {!isRunning && role === 'assistant' && (
              <Button 
                type="text" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={() => aui.message().reload()}
                style={{ color: '#8c8c8c', fontSize: 12 }}
              >
                重新生成
              </Button>
            )}
            {!isRunning && role === 'user' && (
              <Button 
                type="text" 
                size="small" 
                icon={<CodeOutlined />} 
                onClick={() => {
                  // We don't have a built-in edit UI, so we just set the question input to the message content
                  // and let the user send it again. To do true branching, we'd need a composer for the message.
                  // For now, setting the question is a good start.
                  const text = (msg.content.find((c: any) => c.type === 'text') as any)?.text || '';
                  setQuestion(text);
                }}
                style={{ color: '#8c8c8c', fontSize: 12 }}
              >
                编辑
              </Button>
            )}
          </div>
        </div>
      </div>
    </List.Item>
  );
}

export function ChatMessageList({ ctx }: { ctx: KbChatContextType }) {
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  const {
    loading,
    markdownComponents,
    messagesRef,
    requestExampleText,
    sandboxMode,
    workspaceVisible,
  } = ctx;

  return (
<>
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
                {messages.length === 0 && !isRunning && (
                  <div style={{ textAlign: 'center', marginTop: '10vh', color: '#8e8e8e' }}>
                    <RobotOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }} />
                    <Title level={3} style={{ color: '#d9d9d9', fontWeight: 400 }}>今天能帮您解决什么问题？</Title>
                  </div>
                )}
                <List
                  dataSource={[...messages]}
                  split={false}
                  renderItem={(_, idx) => (
                    <MessageByIndexProvider index={idx}>
                      <ChatMessageItem idx={idx} markdownComponents={markdownComponents} setQuestion={ctx.setQuestion} />
                    </MessageByIndexProvider>
                  )}
                />
                {isRunning &&
                  messages.length > 0 &&
                  messages[messages.length - 1]?.role === 'assistant' &&
                  !messages[messages.length - 1]?.content.find((c: any) => c.type === 'text' && c.text) && (
                    <div style={{ padding: '16px 0', display: 'flex', gap: 16 }}>
                      <Avatar icon={<RobotOutlined />} style={{ background: '#10a37f', flex: '0 0 auto' }} />
                      <div style={{ paddingTop: 6 }}>
                        <Spin size="small" /> <Text type="secondary" style={{ marginLeft: 8 }}>正在思考并检索...</Text>
                      </div>
                    </div>
                  )}
              </div>
</>
  );
}
