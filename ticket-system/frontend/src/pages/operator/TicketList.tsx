import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Select, Modal, message, Tooltip, Badge } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import dayjs from 'dayjs';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING:       { label: '待受理', color: 'default' },
  ACCEPTED:      { label: '已受理', color: 'processing' },
  IN_PROGRESS:   { label: '处理中', color: 'blue' },
  PENDING_CLOSE: { label: '待关闭审批', color: 'warning' },
  CLOSED:        { label: '已关闭', color: 'success' },
};

export default function OperatorTicketList() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [engineers, setEngineers] = useState<any[]>([]);
  const [assignModal, setAssignModal] = useState<{ open: boolean; ticketId: string }>({ open: false, ticketId: '' });
  const [selectedEngineer, setSelectedEngineer] = useState<string>('');

  const fetchTickets = async (p = 1, status?: string) => {
    setLoading(true);
    try {
      const params: any = { page: p, pageSize: 20 };
      if (status) params.status = status;
      const { data } = await api.get('/tickets', { params });
      setTickets(data.tickets);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  };

  const fetchEngineers = async () => {
    const { data } = await api.get('/engineers');
    setEngineers(data);
  };

  useEffect(() => { fetchTickets(page, statusFilter); }, [page, statusFilter]);
  useEffect(() => { fetchEngineers(); }, []);

  const handleAssign = async () => {
    if (!selectedEngineer) return message.warning('请选择工程师');
    try {
      await api.put(`/tickets/${assignModal.ticketId}/assign`, { engineerId: selectedEngineer });
      message.success('分配成功');
      setAssignModal({ open: false, ticketId: '' });
      fetchTickets(page, statusFilter);
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  const handleApproveClose = async (ticketId: string) => {
    Modal.confirm({
      title: '确认关闭工单？',
      content: '关闭后工单将不可再修改状态',
      onOk: async () => {
        await api.put(`/tickets/${ticketId}/close-approve`);
        message.success('工单已关闭');
        fetchTickets(page, statusFilter);
      },
    });
  };

  const handleRejectClose = async (ticketId: string) => {
    await api.put(`/tickets/${ticketId}/close-reject`);
    message.success('已驳回，工单回到处理中');
    fetchTickets(page, statusFilter);
  };

  const handleUrge = async (ticketId: string) => {
    await api.post(`/tickets/${ticketId}/urge`, { note: '运营催单' });
    message.success('催单成功');
  };

  const columns = [
    { title: '工单编号', dataIndex: 'ticketNumber', width: 150 },
    { title: '客户', key: 'customer', width: 120, render: (_: any, r: any) => `${r.customer?.name || '-'} (${r.customer?.tier || '-'})` },
    { title: '平台', dataIndex: 'platform', width: 80 },
    { title: '问题描述', dataIndex: 'description', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 120,
      render: (s: string) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag>,
    },
    {
      title: '负责工程师', key: 'engineer', width: 130,
      render: (_: any, r: any) => r.assignedEngineer ? `${r.assignedEngineer.username}(${r.assignedEngineer.level})` : <span style={{ color: '#999' }}>未分配</span>,
    },
    {
      title: 'SLA', dataIndex: 'slaDeadline', width: 120,
      render: (d: string) => {
        const over = dayjs(d).isBefore(dayjs());
        return <span style={{ color: over ? '#ff4d4f' : undefined }}>{dayjs(d).format('MM-DD HH:mm')}</span>;
      },
    },
    {
      title: '操作', key: 'action', width: 220,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => { setAssignModal({ open: true, ticketId: r.id }); setSelectedEngineer(''); }}>
            分配
          </Button>
          {r.status === 'PENDING_CLOSE' && (
            <>
              <Button size="small" type="primary" onClick={() => handleApproveClose(r.id)}>批准关闭</Button>
              <Button size="small" danger onClick={() => handleRejectClose(r.id)}>驳回</Button>
            </>
          )}
          <Tooltip title="催单">
            <Button size="small" icon={<BellOutlined />} onClick={() => handleUrge(r.id)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select placeholder="筛选状态" allowClear style={{ width: 140 }} onChange={setStatusFilter}>
          {Object.entries(STATUS_MAP).map(([k, v]) => (
            <Select.Option key={k} value={k}>{v.label}</Select.Option>
          ))}
        </Select>
        <Badge count={tickets.filter(t => t.status === 'PENDING_CLOSE').length} offset={[4, 0]}>
          <span style={{ color: '#faad14', fontWeight: 500 }}>待审批关闭</span>
        </Badge>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={tickets}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
        size="small"
      />

      <Modal
        title="分配工程师"
        open={assignModal.open}
        onOk={handleAssign}
        onCancel={() => setAssignModal({ open: false, ticketId: '' })}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择工程师"
          value={selectedEngineer || undefined}
          onChange={setSelectedEngineer}
        >
          {engineers.filter(e => e.isAvailable).map((e: any) => (
            <Select.Option key={e.id} value={e.id}>
              {e.username} — {e.level} {!e.isAvailable ? '（不可用）' : ''}
            </Select.Option>
          ))}
        </Select>
      </Modal>
    </>
  );
}
