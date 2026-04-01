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
import api from '../../../../api/axios';

const { Title, Text } = Typography;
const { TextArea } = Input;

export function ChatRightPanel({ ctx }: { ctx: KbChatContextType }) {
  const {
    aiSearchStreamText,
    chat,
    followUps,
    isCustomer,
    llmThinkText,
    loading,
    markdownComponents,
    question,
    retrievalStatus,
    sandboxStatus,
    searchMode,
    selectedTicketIds,
    selectedTickets,
    setQuestion,
    setSelectedTicketIds,
    setSelectedTickets,
    setTicketLoading,
    shouldShowThinkPanel,
    sources,
    thinkHistory,
    ticketLoading,
    ticketOptions,
  } = ctx;

  return (
<>
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
                {shouldShowThinkPanel && (
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
</>
  );
}
