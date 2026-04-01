import React from 'react';
import { Button, Typography, Space, List, Tag, Spin, Avatar, Modal, Upload, Select, Tooltip, Input, message } from 'antd';
import { 
  RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined, ArrowLeftOutlined, 
  PlusOutlined, GlobalOutlined, CodeOutlined, CopyOutlined, UploadOutlined, 
  InfoCircleOutlined, DownloadOutlined, DeleteOutlined 
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { KbChatContextType } from '../useKbChat';

const { Title, Text } = Typography;
const { TextArea } = Input;

export function ChatMessageList({ ctx }: { ctx: KbChatContextType }) {
  const {
    chat,
    loading,
    markdownComponents,
    messagesRef,
    requestExampleText,
    sandboxMode,
    searchMode,
    user,
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
                {chat.length === 0 && !loading && (
                  <div style={{ textAlign: 'center', marginTop: '10vh', color: '#8e8e8e' }}>
                    <RobotOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }} />
                    <Title level={3} style={{ color: '#d9d9d9', fontWeight: 400 }}>今天能帮您解决什么问题？</Title>
                  </div>
                )}
                <List
                  dataSource={chat}
                  split={false}
                  renderItem={(item: any) => (
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
</>
  );
}
