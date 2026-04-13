import React, { useEffect, useState } from 'react';
import { Form, Input, Select, Button, Card, Upload, message, Typography, Space, Radio, Alert } from 'antd';
import { UploadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export default function OperatorCreateTicket() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    api.get('/customers')
      .then(({ data }) => {
        const mine = Array.isArray(data)
          ? data.filter((c: any) => c.createdBy === user?.id)
          : [];
        setCustomers(mine);
      })
      .catch(() => {});
  }, [user?.id]);

  const handleUpload = async (file: File) => {
    try {
      const { data } = await api.post('/attachments/sas-token', { fileName: file.name });
      const resp = await fetch(data.sasUrl, {
        method: 'PUT',
        body: file,
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!resp.ok) throw new Error(`Blob 返回 ${resp.status}`);
      const url = data.sasUrl.split('?')[0];
      setAttachmentUrls((prev) => [...prev, url]);
      message.success(`${file.name} 上传成功`);
    } catch (err: any) {
      message.error(`${file.name} 上传失败：${err?.message || '请检查网络后重试'}`);
    }
    return false;
  };

  const onFinish = async (values: any) => {
    const { customerId, ...rest } = values;
    if (!customerId) {
      message.error('请选择客户');
      return;
    }
    setLoading(true);
    try {
      const payload = { ...rest, attachmentUrls };
      await api.post(`/tickets/for-customer/${customerId}`, payload);
      message.success('工单已提交');
      navigate('/operator');
    } catch (err: any) {
      message.error(err.response?.data?.message || '提交失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '24px auto', padding: '0 16px' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operator')}>返回</Button>
        <Title level={4} style={{ margin: 0 }}>打工单</Title>
      </Space>

      <Card bordered={false}>
        {customers.length === 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="暂无您创建的客户"
            description={
              <span>
                请先在 <Link to="/operator/customers">客户管理</Link> 中创建客户，再在此发起工单。
              </span>
            }
          />
        )}
        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ assistancePhase: 'POSTSALES' }}>
          <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
            <Select
              placeholder="选择要关联的客户（仅列出您创建的客户）"
              showSearch
              optionFilterProp="children"
              size="large"
            >
              {customers.map((c) => (
                <Option key={c.id} value={c.id}>
                  {c.name} ({c.customerCode})
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="platform" label="使用平台" rules={[{ required: true, message: '请选择平台' }]}>
            <Select placeholder="请选择平台" size="large">
              <Option value="taiji">太极平台</Option>
              <Option value="xm">XM 平台</Option>
              <Option value="original">原厂（GCP / AWS / Azure）</Option>
            </Select>
          </Form.Item>

          <Form.Item name="assistancePhase" label="工单类型" rules={[{ required: true, message: '请选择售前或售后' }]}>
            <Radio.Group>
              <Radio.Button value="PRESALES">售前</Radio.Button>
              <Radio.Button value="POSTSALES">售后</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="accountInfo" label="账号信息" rules={[{ required: true, message: '请填写账号信息' }]}
            extra="平台账号名称/代号，或原厂账号、订阅名称、Project ID">
            <Input placeholder="如：user@company.com 或 subscription-name / project-id" />
          </Form.Item>

          <Form.Item name="modelUsed" label="使用的模型" rules={[{ required: true, message: '请填写使用的模型' }]}>
            <Input placeholder="如：GPT-4o、Claude 3.5、Gemini Pro" />
          </Form.Item>

          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请描述问题' }]}>
            <TextArea rows={5} placeholder="请详细描述需要技术协助的内容" />
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
