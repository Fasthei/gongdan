import React from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Switch, message } from 'antd';
import { UnorderedListOutlined, LogoutOutlined, SettingOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import TicketList from './TicketList';
import TicketDetail from './TicketDetail';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

export default function EngineerDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [available, setAvailable] = React.useState(true);

  const handleLogout = () => { logout(); navigate('/staff/login'); };

  const toggleAvailability = async (checked: boolean) => {
    try {
      await api.patch('/engineers/me/availability', { isAvailable: checked });
      setAvailable(checked);
      message.success(checked ? '已设为可接单' : '已设为暂停接单');
    } catch {
      message.error('状态更新失败');
    }
  };

  const menuItems = [
    { key: '/engineer', icon: <UnorderedListOutlined />, label: <Link to="/engineer">我的工单</Link> },
    { key: '/engineer/settings', icon: <SettingOutlined />, label: <Link to="/engineer/settings">设置</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={200}>
        <div style={{ padding: '16px', color: '#fff', fontWeight: 'bold', fontSize: 16 }}>工程师后台</div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text>欢迎，{user?.username}（{user?.level}）</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span>接单状态：</span>
            <Switch checked={available} onChange={toggleAvailability} checkedChildren="可接单" unCheckedChildren="暂停" />
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
          </div>
        </Header>
        <Content style={{ margin: 24 }}>
          <Routes>
            <Route path="/" element={<TicketList />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/settings" element={<EngineerSettings />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function EngineerSettings() {
  const [form, setForm] = React.useState({ email: '' });
  const [loading, setLoading] = React.useState(false);

  const handleSave = async () => {
    if (!form.email) return message.warning('请输入邮箱');
    setLoading(true);
    try {
      await api.patch('/engineers/me/email', { email: form.email });
      message.success('邮箱更新成功');
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400 }}>
      <Typography.Title level={5}>修改邮箱</Typography.Title>
      <input
        type="email"
        placeholder="新邮箱地址"
        value={form.email}
        onChange={e => setForm({ email: e.target.value })}
        style={{ width: '100%', padding: '8px 12px', marginBottom: 12, border: '1px solid #d9d9d9', borderRadius: 6 }}
      />
      <Button type="primary" onClick={handleSave} loading={loading}>保存</Button>
    </div>
  );
}
