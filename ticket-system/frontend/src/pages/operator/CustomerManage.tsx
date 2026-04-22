import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, message, Tag, Space, Popconfirm } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import api from '../../api/axios';

const TIER_MAP: Record<string, { label: string; color: string }> = {
  NORMAL:    { label: '普通客户', color: 'default' },
  KEY:       { label: '重点客户', color: 'blue' },
  EXCLUSIVE: { label: '专属客户', color: 'gold' },
};

export default function CustomerManage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [engineers, setEngineers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [tierModal, setTierModal] = useState<{ open: boolean; customerId: string }>({ open: false, customerId: '' });
  const [bindModal, setBindModal] = useState<{ open: boolean; customerId: string }>({ open: false, customerId: '' });
  const [form] = Form.useForm();
  const [tierForm] = Form.useForm();
  const [bindForm] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [c, e] = await Promise.all([api.get('/customers'), api.get('/engineers')]);
      setCustomers(c.data);
      setEngineers(e.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/customers', values);
      message.success('客户创建成功');
      setCreateModal(false);
      form.resetFields();
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建失败');
    }
  };

  const handleUpdateTier = async (values: any) => {
    try {
      await api.patch(`/customers/${tierModal.customerId}/tier`, values);
      message.success('等级更新成功');
      setTierModal({ open: false, customerId: '' });
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    }
  };

  const handleBindEngineer = async (values: any) => {
    try {
      await api.patch(`/customers/${bindModal.customerId}/bind-engineer`, values);
      message.success('绑定成功');
      setBindModal({ open: false, customerId: '' });
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '绑定失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/customers/${id}`);
      message.success('客户已删除');
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const columns = [
    { title: '客户编号', dataIndex: 'customerCode', width: 160 },
    { title: '客户名称', dataIndex: 'name' },
    {
      title: '等级', dataIndex: 'tier', width: 120,
      render: (t: string) => <Tag color={TIER_MAP[t]?.color}>{TIER_MAP[t]?.label || t}</Tag>,
    },
    { title: '首次响应', key: 'sla', width: 100, render: (_: any, r: any) => `${r.firstResponseHours}h` },
    {
      title: '绑定工程师', key: 'bound', width: 130,
      render: (_: any, r: any) => {
        const eng = engineers.find(e => e.id === r.boundEngineerId);
        return eng ? `${eng.username}(${eng.level})` : '-';
      },
    },
    {
      title: '操作', key: 'action', width: 280,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => { setTierModal({ open: true, customerId: r.id }); tierForm.setFieldsValue({ tier: r.tier }); }}>
            改等级
          </Button>
          <Button size="small" onClick={() => { setBindModal({ open: true, customerId: r.id }); bindForm.resetFields(); }}>
            绑工程师
          </Button>
          <Popconfirm
            title="确认删除该客户？"
            description="删除后该客户将无法登录，其历史工单仍会保留。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(r.id)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setCreateModal(true)}>
        新建客户
      </Button>

      <Table rowKey="id" columns={columns} dataSource={customers} loading={loading} size="small" />

      {/* 新建客户 */}
      <Modal title="新建客户" open={createModal} onOk={() => form.submit()} onCancel={() => setCreateModal(false)}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="客户名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="tier" label="客户等级" initialValue="NORMAL">
            <Select>
              {Object.entries(TIER_MAP).map(([k, v]) => <Select.Option key={k} value={k}>{v.label}</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 修改等级 */}
      <Modal title="修改客户等级" open={tierModal.open} onOk={() => tierForm.submit()} onCancel={() => setTierModal({ open: false, customerId: '' })}>
        <Form form={tierForm} layout="vertical" onFinish={handleUpdateTier}>
          <Form.Item name="tier" label="新等级" rules={[{ required: true }]}>
            <Select>
              {Object.entries(TIER_MAP).map(([k, v]) => <Select.Option key={k} value={k}>{v.label}</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 绑定工程师 */}
      <Modal title="绑定专属工程师" open={bindModal.open} onOk={() => bindForm.submit()} onCancel={() => setBindModal({ open: false, customerId: '' })}>
        <Form form={bindForm} layout="vertical" onFinish={handleBindEngineer}>
          <Form.Item name="engineerId" label="选择工程师" rules={[{ required: true }]}>
            <Select placeholder="选择工程师">
              {engineers.map((e: any) => (
                <Select.Option key={e.id} value={e.id}>{e.username} — {e.level}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
