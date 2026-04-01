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

export function DocWorkspace({ ctx }: { ctx: KbChatContextType }) {
  const {
    applyDocTemplate,
    docEvidenceSummary,
    docGenLoading,
    docGenResult,
    loading,
    runDocGeneration,
    setWorkspaceText,
    workspaceText,
    workspaceVisible,
  } = ctx;

  return (
<>
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
</>
  );
}
