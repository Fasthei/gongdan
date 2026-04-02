import React, { useEffect, useState } from 'react';
import {
  Button, Table, Tag, Typography, Space, Modal, Form, Input, Select,
  message, Tooltip, Switch, DatePicker, Alert, Card
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CopyOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

const MODULE_OPTIONS = [
  { label: '工单相关 API', value: 'ticket' },
  { label: '客户相关 API', value: 'customer' },
  { label: '工程师相关 API', value: 'engineer' },
  { label: '附件相关 API', value: 'attachment' },
  { label: '状态监控 API', value: 'statusMonitor' },
];

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  allowedModules: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
};

export default function ApiPermissionControl() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api-keys');
      setKeys(Array.isArray(data) ? data : []);
    } catch (err: any) {
      message.error(err.response?.data?.message || '加载密钥列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      const payload = {
        name: values.name,
        allowedModules: values.allowedModules,
        ...(values.expiresAt ? { expiresAt: dayjs(values.expiresAt).toISOString() } : {}),
      };
      const { data } = await api.post('/api-keys', payload);
      setNewKeyValue(data.key);
      setCreateOpen(false);
      form.resetFields();
      await load();
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建失败');
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    const values = await editForm.validateFields();
    try {
      const payload: any = {};
      if (values.name) payload.name = values.name;
      if (values.allowedModules) payload.allowedModules = values.allowedModules;
      if (values.expiresAt !== undefined) {
        payload.expiresAt = values.expiresAt ? dayjs(values.expiresAt).toISOString() : null;
      }
      await api.patch(`/api-keys/${editTarget.id}`, payload);
      message.success('已更新');
      setEditTarget(null);
      await load();
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    }
  };

  const toggleEnabled = async (record: ApiKey, enabled: boolean) => {
    try {
      await api.patch(`/api-keys/${record.id}`, { enabled });
      message.success(enabled ? '已启用' : '已禁用');
      setKeys((prev) => prev.map((k) => k.id === record.id ? { ...k, enabled } : k));
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  const handleRevoke = (record: ApiKey) => {
    Modal.confirm({
      title: '撤销 API 密钥',
      icon: <ExclamationCircleOutlined />,
      content: `确定要撤销「${record.name}」？撤销后使用该密钥的所有请求将立即失败，且不可恢复。`,
      okText: '确认撤销',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.delete(`/api-keys/${record.id}`);
          message.success('密钥已撤销');
          await load();
        } catch (err: any) {
          message.error(err.response?.data?.message || '撤销失败');
        }
      },
    });
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '密钥前缀',
      dataIndex: 'keyPrefix',
      key: 'keyPrefix',
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>{v}...</Text>
      ),
    },
    {
      title: '允许模块',
      dataIndex: 'allowedModules',
      key: 'allowedModules',
      render: (mods: string[]) => (
        <Space size={4} wrap>
          {mods.map((m) => (
            <Tag key={m} color="blue" style={{ fontSize: 11 }}>
              {MODULE_OPTIONS.find((o) => o.value === m)?.label ?? m}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (enabled: boolean, record: ApiKey) => (
        <Switch
          checked={enabled}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          size="small"
          onChange={(v) => void toggleEnabled(record, v)}
        />
      ),
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 140,
      render: (v?: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : <Text type="secondary">未使用</Text>,
    },
    {
      title: '到期时间',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 140,
      render: (v?: string | null) => {
        if (!v) return <Text type="secondary">永不过期</Text>;
        const expired = dayjs(v).isBefore(dayjs());
        return <Text type={expired ? 'danger' : 'secondary'}>{dayjs(v).format('YYYY-MM-DD')}</Text>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: ApiKey) => (
        <Space>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditTarget(record);
                editForm.setFieldsValue({
                  name: record.name,
                  allowedModules: record.allowedModules,
                  expiresAt: record.expiresAt ? dayjs(record.expiresAt) : null,
                });
              }}
            />
          </Tooltip>
          <Tooltip title="撤销">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRevoke(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>API 密钥管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          创建密钥
        </Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Text type="secondary">
          外部系统通过在请求头中携带 <Text code>X-Api-Key: &lt;密钥&gt;</Text> 访问 API，无需用户登录。
          每个密钥可精确控制能访问哪些模块。密钥明文仅在创建时展示一次，请妥善保存。
        </Text>
      </Card>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={keys}
        loading={loading}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: '暂无 API 密钥，点击右上角「创建密钥」' }}
      />

      {/* 创建密钥 Modal */}
      <Modal
        title="创建 API 密钥"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：ERP 系统集成、监控平台" />
          </Form.Item>
          <Form.Item
            name="allowedModules"
            label="允许访问的模块"
            rules={[{ required: true, message: '请至少选择一个模块' }]}
          >
            <Select mode="multiple" options={MODULE_OPTIONS} placeholder="选择允许访问的模块" />
          </Form.Item>
          <Form.Item name="expiresAt" label="过期时间（可选，不填永不过期）">
            <DatePicker style={{ width: '100%' }} placeholder="选择过期日期" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建成功 — 显示明文密钥 */}
      <Modal
        title="密钥创建成功"
        open={!!newKeyValue}
        footer={
          <Button type="primary" onClick={() => setNewKeyValue(null)}>
            我已复制，关闭
          </Button>
        }
        onCancel={() => setNewKeyValue(null)}
        closable={false}
        maskClosable={false}
      >
        <Alert
          type="warning"
          showIcon
          message="请立即复制，此密钥只显示一次，关闭后无法再查看！"
          style={{ marginBottom: 16 }}
        />
        <Paragraph copyable={{ text: newKeyValue ?? '' }} style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {newKeyValue}
        </Paragraph>
        <Button
          icon={<CopyOutlined />}
          block
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(newKeyValue ?? '');
              message.success('已复制');
            } catch {
              message.error('复制失败，请手动复制');
            }
          }}
        >
          复制密钥
        </Button>
      </Modal>

      {/* 编辑 Modal */}
      <Modal
        title="编辑 API 密钥"
        open={!!editTarget}
        onOk={handleEdit}
        onCancel={() => { setEditTarget(null); editForm.resetFields(); }}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="allowedModules" label="允许访问的模块" rules={[{ required: true }]}>
            <Select mode="multiple" options={MODULE_OPTIONS} />
          </Form.Item>
          <Form.Item name="expiresAt" label="过期时间（留空则永不过期）">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
