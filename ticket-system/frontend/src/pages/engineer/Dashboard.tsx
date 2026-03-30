import React from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Switch, message, Form, Input, Select, Checkbox, Divider } from 'antd';
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
    { key: '/kb-chat', icon: <SettingOutlined />, label: <Link to="/kb-chat">知识库对话</Link> },
    ...(user?.role === 'ADMIN'
      ? [{ key: '/engineer/admin', icon: <SettingOutlined />, label: <Link to="/engineer/admin">管理员账户管理</Link> }]
      : []),
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
            {user?.role === 'ADMIN' && <Route path="/admin" element={<AdminAccountSettings />} />}
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function EngineerSettings() {
  const [form, setForm] = React.useState({ email: '' });
  const [pwdForm, setPwdForm] = React.useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = React.useState(false);
  const [pwdLoading, setPwdLoading] = React.useState(false);

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

  const handleChangePassword = async () => {
    if (!pwdForm.oldPassword || !pwdForm.newPassword) return message.warning('请填写完整密码信息');
    if (pwdForm.newPassword !== pwdForm.confirmPassword) return message.warning('两次输入的新密码不一致');
    setPwdLoading(true);
    try {
      await api.patch('/engineers/me/password', {
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
        placeholder="新邮箱地址"
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
      <Button type="primary" onClick={handleChangePassword} loading={pwdLoading}>更新密码</Button>
    </div>
  );
}

function AdminAccountSettings() {
  const [engineerForm] = Form.useForm();
  const [operatorForm] = Form.useForm();
  const [engLoading, setEngLoading] = React.useState(false);
  const [opLoading, setOpLoading] = React.useState(false);
  const [kbLoading, setKbLoading] = React.useState(false);

  const handleCreateEngineer = async (values: any) => {
    setEngLoading(true);
    try {
      await api.post('/engineers', values);
      message.success('技术账户创建成功');
      engineerForm.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.message || '技术账户创建失败');
    } finally {
      setEngLoading(false);
    }
  };

  const handleCreateOperator = async (values: any) => {
    setOpLoading(true);
    try {
      await api.post('/engineers/operators', values);
      message.success('运营账户创建成功');
      operatorForm.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.message || '运营账户创建失败');
    } finally {
      setOpLoading(false);
    }
  };

  const handleUploadKnowledge = async (file: File) => {
    setKbLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/knowledge-base/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('知识库资料上传成功');
    } catch (err: any) {
      message.error(err.response?.data?.message || '知识库资料上传失败');
    } finally {
      setKbLoading(false);
    }
    return false;
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <Typography.Title level={5}>新增技术账户</Typography.Title>
      <Form form={engineerForm} layout="vertical" onFinish={handleCreateEngineer}>
        <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="password" label="初始密码" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="level" label="工程师级别" rules={[{ required: true }]} initialValue="L1">
          <Select options={[{ value: 'L1' }, { value: 'L2' }, { value: 'L3' }]} />
        </Form.Item>
        <Form.Item name="isAdmin" valuePropName="checked">
          <Checkbox>管理员工程师</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={engLoading}>创建技术账户</Button>
      </Form>

      <Divider />

      <Typography.Title level={5}>新增运营账户</Typography.Title>
      <Form form={operatorForm} layout="vertical" onFinish={handleCreateOperator}>
        <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="password" label="初始密码" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={opLoading}>创建运营账户</Button>
      </Form>

      <Divider />

      <Typography.Title level={5}>上传知识库资料</Typography.Title>
      <input
        type="file"
        disabled={kbLoading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUploadKnowledge(f);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
