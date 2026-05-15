import React from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, message, Input, Divider } from 'antd';
import {
  UnorderedListOutlined, TeamOutlined, LogoutOutlined, DashboardOutlined, FormOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import api from '../../api/axios';
import TicketList from './TicketList';
import CustomerManage from './CustomerManage';
import StatusBoard from './StatusBoard';
import OperatorCreateTicket from './CreateTicket';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

export default function OperatorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const handleLogout = () => { logout(); navigate('/staff/login'); };

  const menuItems = [
    { key: '/operator', icon: <UnorderedListOutlined />, label: <Link to="/operator">{t('operator.ticketManagement')}</Link> },
    { key: '/operator/create-ticket', icon: <FormOutlined />, label: <Link to="/operator/create-ticket">打工单</Link> },
    { key: '/operator/customers', icon: <TeamOutlined />, label: <Link to="/operator/customers">{t('operator.customerManagement')}</Link> },
    { key: '/operator/status', icon: <DashboardOutlined />, label: <Link to="/operator/status">{t('operator.serviceStatus')}</Link> },
    { key: '/operator/settings', icon: <SettingOutlined />, label: <Link to="/operator/settings">设置</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={240} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '24px 16px', fontWeight: 'bold', fontSize: 18, color: '#1a73e8' }}>
          {t('operator.title')}
        </div>
        <Menu theme="light" mode="inline" selectedKeys={[location.pathname]} items={menuItems} style={{ borderRight: 'none' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
          <Text>{t('common.welcome', { name: user?.username })}</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LanguageSwitcher />
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>{t('common.logout')}</Button>
          </div>
        </Header>
        <Content style={{ margin: 24 }}>
          <Routes>
            <Route path="/" element={<TicketList />} />
            <Route path="/create-ticket" element={<OperatorCreateTicket />} />
            <Route path="/customers" element={<CustomerManage />} />
            <Route path="/status" element={<StatusBoard />} />
            <Route path="/settings" element={<OperatorSettings />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function OperatorSettings() {
  const [form, setForm] = React.useState({ email: '' });
  const [pwdForm, setPwdForm] = React.useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = React.useState(false);
  const [pwdLoading, setPwdLoading] = React.useState(false);

  React.useEffect(() => {
    api.get('/operators/me').then(({ data }) => {
      if (data?.email) setForm({ email: data.email });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!form.email) return message.warning('请输入邮箱');
    setLoading(true);
    try {
      await api.patch('/operators/me/email', { email: form.email });
      message.success('邮箱修改成功');
      setForm({ email: form.email });
    } catch (err: any) {
      message.error(err.response?.data?.message || '邮箱修改失败');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!pwdForm.oldPassword || !pwdForm.newPassword) return message.warning('请填写旧密码和新密码');
    if (pwdForm.newPassword !== pwdForm.confirmPassword) return message.warning('两次输入的新密码不一致');
    setPwdLoading(true);
    try {
      await api.patch('/operators/me/password', {
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword,
      });
      message.success('密码修改成功');
      setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      message.error(err.response?.data?.message || '密码修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400 }}>
      <Typography.Title level={5}>修改邮箱</Typography.Title>
      <input
        type="email"
        placeholder="请输入邮箱"
        value={form.email}
        onChange={e => setForm({ email: e.target.value })}
        style={{ width: '100%', padding: '8px 12px', marginBottom: 12, border: '1px solid #d9d9d9', borderRadius: 6 }}
      />
      <Button type="primary" onClick={handleSave} loading={loading}>保存</Button>

      <Divider />

      <Typography.Title level={5}>修改密码</Typography.Title>
      <Input.Password
        placeholder="旧密码"
        value={pwdForm.oldPassword}
        onChange={e => setPwdForm({ ...pwdForm, oldPassword: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <Input.Password
        placeholder="新密码"
        value={pwdForm.newPassword}
        onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <Input.Password
        placeholder="确认新密码"
        value={pwdForm.confirmPassword}
        onChange={e => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
        style={{ marginBottom: 12 }}
      />
      <Button type="primary" onClick={handleChangePassword} loading={pwdLoading}>保存密码</Button>
    </div>
  );
}
