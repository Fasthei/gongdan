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

export function SandboxModal({ ctx }: { ctx: KbChatContextType }) {
  const {
    CURL_EXAMPLE_TEMPLATE,
    exampleFileList,
    exampleModalOpen,
    requestExampleText,
    sandboxMode,
    setExampleFileList,
    setExampleModalOpen,
    setRequestExampleText,
  } = ctx;

  return (
<>
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
</>
  );
}
