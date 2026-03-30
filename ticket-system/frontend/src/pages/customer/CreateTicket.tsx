import React, { useState } from 'react';
import { Form, Input, Select, Button, Card, Upload, message, Typography, Space } from 'antd';
import { UploadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export default function CreateTicket() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const navigate = useNavigate();

  const handleUpload = async (file: File) => {
    try {
      const { data } = await api.post('/attachments/sas-token', { fileName: file.name });
      // 直传到 Blob Storage
      await fetch(data.sasUrl, { method: 'PUT', body: file, headers: { 'x-ms-blob-type': 'BlockBlob' } });
      const url = data.sasUrl.split('?')[0];
      setAttachmentUrls((prev) => [...prev, url]);
      message.success(`${file.name} 上传成功`);
    } catch {
      message.warning(`${file.name} 上传失败，可继续提交工单`);
    }
    return false; // 阻止 antd 默认上传
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      await api.post('/tickets', { ...values, attachmentUrls });
      message.success('工单提交成功');
      navigate('/tickets');
    } catch (err: any) {
      message.error(err.response?.data?.message || '提交失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '24px auto', padding: '0 16px' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tickets')}>返回</Button>
        <Title level={4} style={{ margin: 0 }}>提交新工单</Title>
      </Space>

      <Card>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="platform" label="使用平台" rules={[{ required: true, message: '请选择平台' }]}>
            <Select placeholder="请选择平台" size="large">
              <Option value="taiji">太极平台</Option>
              <Option value="xm">XM 平台</Option>
              <Option value="original">原厂（GCP / AWS / Azure）</Option>
            </Select>
          </Form.Item>

          <Form.Item name="accountInfo" label="账号信息" rules={[{ required: true, message: '请填写账号信息' }]}
            extra="平台账号名称/代号，或原厂账号、订阅名称、Project ID">
            <Input placeholder="如：user@company.com 或 subscription-name / project-id" />
          </Form.Item>

          <Form.Item name="modelUsed" label="使用的模型" rules={[{ required: true, message: '请填写使用的模型' }]}>
            <Input placeholder="如：GPT-4o、Claude 3.5、Gemini Pro" />
          </Form.Item>

          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请描述问题' }]}>
            <TextArea rows={5} placeholder="请详细描述遇到的问题，包括错误信息、复现步骤等" />
          </Form.Item>

          <Form.Item name="requestExample" label="请求示例" rules={[{ required: true, message: '请提供请求示例' }]}>
            <TextArea rows={5} placeholder="请粘贴 API 请求示例（curl、代码片段等）" />
          </Form.Item>

          <Form.Item name="framework" label="使用的框架或 AI 应用程序（选填）">
            <Input placeholder="如：LangChain、LlamaIndex、自研应用" />
          </Form.Item>

          <Form.Item name="networkEnv" label="网络环境（选填）">
            <Select placeholder="请选择网络环境" allowClear>
              <Option value="local">本地环境</Option>
              <Option value="cloud">云上环境</Option>
            </Select>
          </Form.Item>

          <Form.Item name="contactInfo" label="联系方式（选填）"
            rules={[{ pattern: /^[\w.-]+@[\w.-]+\.\w+$|^1[3-9]\d{9}$/, message: '请输入有效的邮箱或手机号' }]}>
            <Input placeholder="邮箱或手机号" />
          </Form.Item>

          <Form.Item name="requestedLevel" label="期望工程师级别（选填）">
            <Select placeholder="不选则由系统自动分配" allowClear>
              <Option value="L1">L1 工程师（常规问题）</Option>
              <Option value="L2">L2 高级工程师（复杂问题）</Option>
              <Option value="L3">L3 专家（架构级问题）</Option>
            </Select>
          </Form.Item>

          <Form.Item label="上传附件（选填）">
            <Upload beforeUpload={handleUpload} showUploadList={false} multiple>
              <Button icon={<UploadOutlined />}>选择文件上传</Button>
            </Upload>
            {attachmentUrls.length > 0 && (
              <div style={{ marginTop: 8, color: '#52c41a' }}>已上传 {attachmentUrls.length} 个文件</div>
            )}
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} size="large" block>
              提交工单
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
