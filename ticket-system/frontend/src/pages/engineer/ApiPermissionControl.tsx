import React, { useEffect, useState } from 'react';
import { Card, Switch, Typography, Space, Button, message, Descriptions } from 'antd';
import api from '../../api/axios';

type ModulePermission = {
  moduleKey: string;
  enabled: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

const LABEL_MAP: Record<string, string> = {
  ticket: '工单相关 API',
  customer: '客户相关 API',
  engineer: '工程师相关 API',
  attachment: '附件相关 API',
  statusMonitor: '状态监控 API',
};

export default function ApiPermissionControl() {
  const [modules, setModules] = useState<ModulePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api-permissions/modules');
      setModules(Array.isArray(data) ? data : []);
    } catch (err: any) {
      message.error(err.response?.data?.message || '加载 API 权限失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setEnabled = async (moduleKey: string, enabled: boolean) => {
    setSavingKey(moduleKey);
    const prev = modules.find((m) => m.moduleKey === moduleKey);
    setModules((cur) => cur.map((m) => (m.moduleKey === moduleKey ? { ...m, enabled } : m)));

    try {
      await api.patch(`/api-permissions/modules/${moduleKey}`, { enabled });
      message.success(`${LABEL_MAP[moduleKey] || moduleKey} 已${enabled ? '启用' : '禁用'}`);
    } catch (err: any) {
      setModules((cur) => cur.map((m) => (m.moduleKey === moduleKey ? { ...m, enabled: prev?.enabled ?? false } : m)));
      message.error(err.response?.data?.message || '更新失败');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 8 }}>
        API 权限控制
      </Typography.Title>

      <Card loading={loading} style={{ marginTop: 16 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {modules.map((m) => (
            <Card
              key={m.moduleKey}
              type="inner"
              style={{ borderRadius: 12 }}
              extra={
                <Switch
                  checked={m.enabled}
                  disabled={savingKey === m.moduleKey}
                  onChange={(checked) => void setEnabled(m.moduleKey, checked)}
                />
              }
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <Typography.Text strong>{LABEL_MAP[m.moduleKey] || m.moduleKey}</Typography.Text>
                  <div style={{ color: '#5f6368', marginTop: 6, fontSize: 12 }}>
                    当前：{m.enabled ? '启用' : '禁用'}
                  </div>
                </div>
                <Descriptions size="small" column={1} style={{ marginLeft: 'auto' }}>
                  <Descriptions.Item label="最近更新时间">
                    {m.updatedAt ? String(m.updatedAt) : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="最近操作人">
                    {m.updatedBy || '-'}
                  </Descriptions.Item>
                </Descriptions>
              </div>
            </Card>
          ))}

          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      </Card>
    </div>
  );
}

