import React from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Switch, message, Form, Input, Select, Checkbox, Divider, Table, Modal, Popconfirm, Space as AntSpace } from 'antd';
import { UnorderedListOutlined, LogoutOutlined, SettingOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import TicketList from './TicketList';
import TicketDetail from './TicketDetail';
import ApiPermissionControl from './ApiPermissionControl';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

export default function EngineerDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [available, setAvailable] = React.useState(true);
  const { t } = useTranslation();

  const handleLogout = () => { logout(); navigate('/staff/login'); };

  const toggleAvailability = async (checked: boolean) => {
    try {
      await api.patch('/engineers/me/availability', { isAvailable: checked });
      setAvailable(checked);
      message.success(checked ? t('engineer.availableSuccess') : t('engineer.unavailableSuccess'));
    } catch {
      message.error(t('engineer.statusUpdateFailed'));
    }
  };

  const menuItems = [
    { key: '/engineer', icon: <UnorderedListOutlined />, label: <Link to="/engineer">{t('engineer.myTickets')}</Link> },
    { key: '/engineer/settings', icon: <SettingOutlined />, label: <Link to="/engineer/settings">{t('engineer.settings')}</Link> },
    ...(user?.role === 'ADMIN'
      ? [
          { key: '/engineer/admin/api-permissions', icon: <SettingOutlined />, label: <Link to="/engineer/admin/api-permissions">{t('engineer.apiPermissions')}</Link> },
          { key: '/engineer/admin', icon: <SettingOutlined />, label: <Link to="/engineer/admin">{t('engineer.adminAccounts')}</Link> },
        ]
      : []),
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={240} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '24px 16px', fontWeight: 'bold', fontSize: 18, color: '#1a73e8' }}>
          {t('engineer.title')}
        </div>
        <Menu theme="light" mode="inline" selectedKeys={[location.pathname]} items={menuItems} style={{ borderRight: 'none' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
          <Text>{t('common.welcome', { name: user?.username })}（{user?.level}）</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span>{t('engineer.availableStatus')}</span>
            <Switch checked={available} onChange={toggleAvailability} checkedChildren={t('engineer.available')} unCheckedChildren={t('engineer.unavailable')} />
            <LanguageSwitcher />
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>{t('common.logout')}</Button>
          </div>
        </Header>
        <Content style={{ margin: 24 }}>
          <Routes>
            <Route path="/" element={<TicketList />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/settings" element={<EngineerSettings />} />
            {user?.role === 'ADMIN' && <Route path="/admin" element={<AdminAccountSettings />} />}
            {user?.role === 'ADMIN' && <Route path="/admin/api-permissions" element={<ApiPermissionControl />} />}
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
  const { t } = useTranslation();

  const handleSave = async () => {
    if (!form.email) return message.warning(t('engineerSettings.emailPlaceholder'));
    setLoading(true);
    try {
      await api.patch('/engineers/me/email', { email: form.email });
      message.success(t('engineerSettings.emailSuccess'));
    } catch (err: any) {
      message.error(err.response?.data?.message || t('engineerSettings.emailFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!pwdForm.oldPassword || !pwdForm.newPassword) return message.warning(t('engineerSettings.passwordRequired'));
    if (pwdForm.newPassword !== pwdForm.confirmPassword) return message.warning(t('engineerSettings.passwordMismatch'));
    setPwdLoading(true);
    try {
      await api.patch('/engineers/me/password', {
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword,
      });
      message.success(t('engineerSettings.passwordSuccess'));
      setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      message.error(err.response?.data?.message || t('engineerSettings.passwordFailed'));
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400 }}>
      <Typography.Title level={5}>{t('engineerSettings.changeEmail')}</Typography.Title>
      <input
        type="email"
        placeholder={t('engineerSettings.emailPlaceholder')}
        value={form.email}
        onChange={e => setForm({ email: e.target.value })}
        style={{ width: '100%', padding: '8px 12px', marginBottom: 12, border: '1px solid #d9d9d9', borderRadius: 6 }}
      />
      <Button type="primary" onClick={handleSave} loading={loading}>{t('common.save')}</Button>

      <Divider />

      <Typography.Title level={5}>{t('engineerSettings.changePassword')}</Typography.Title>
      <Input.Password
        placeholder={t('engineerSettings.oldPassword')}
        value={pwdForm.oldPassword}
        onChange={e => setPwdForm({ ...pwdForm, oldPassword: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <Input.Password
        placeholder={t('engineerSettings.newPassword')}
        value={pwdForm.newPassword}
        onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <Input.Password
        placeholder={t('engineerSettings.confirmPassword')}
        value={pwdForm.confirmPassword}
        onChange={e => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
        style={{ marginBottom: 12 }}
      />
      <Button type="primary" onClick={handleChangePassword} loading={pwdLoading}>{t('engineerSettings.savePassword')}</Button>
    </div>
  );
}

function AdminAccountSettings() {
  const [engineerForm] = Form.useForm();
  const [operatorForm] = Form.useForm();
  const [engLoading, setEngLoading] = React.useState(false);
  const [opLoading, setOpLoading] = React.useState(false);
  const [engineers, setEngineers] = React.useState<any[]>([]);
  const [operators, setOperators] = React.useState<any[]>([]);
  const [tableLoading, setTableLoading] = React.useState(false);
  const [editEngineer, setEditEngineer] = React.useState<any | null>(null);
  const [editOperator, setEditOperator] = React.useState<any | null>(null);
  const [pwdTarget, setPwdTarget] = React.useState<{ type: 'engineer' | 'operator'; id: string; username: string } | null>(null);
  const [newPassword, setNewPassword] = React.useState('');
  const [editForm] = Form.useForm();

  const loadAccounts = async () => {
    setTableLoading(true);
    try {
      const [engRes, opRes] = await Promise.all([
        api.get('/engineers/admin/engineers'),
        api.get('/engineers/admin/operators'),
      ]);
      setEngineers(Array.isArray(engRes.data) ? engRes.data : []);
      setOperators(Array.isArray(opRes.data) ? opRes.data : []);
    } catch (err: any) {
      message.error(err.response?.data?.message || '加载账户列表失败');
    } finally {
      setTableLoading(false);
    }
  };

  React.useEffect(() => {
    void loadAccounts();
  }, []);

  const handleCreateEngineer = async (values: any) => {
    setEngLoading(true);
    try {
      await api.post('/engineers', values);
      message.success('技术账户创建成功');
      engineerForm.resetFields();
      await loadAccounts();
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
      await loadAccounts();
    } catch (err: any) {
      message.error(err.response?.data?.message || '运营账户创建失败');
    } finally {
      setOpLoading(false);
    }
  };

  const submitEdit = async () => {
    const values = await editForm.validateFields();
    try {
      if (editEngineer) {
        await api.patch(`/engineers/admin/engineers/${editEngineer.id}`, values);
        message.success('工程师账户更新成功');
      } else if (editOperator) {
        await api.patch(`/engineers/admin/operators/${editOperator.id}`, values);
        message.success('运营账户更新成功');
      }
      setEditEngineer(null);
      setEditOperator(null);
      editForm.resetFields();
      await loadAccounts();
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    }
  };

  const submitResetPassword = async () => {
    if (!pwdTarget || !newPassword) return message.warning('请输入新密码');
    try {
      if (pwdTarget.type === 'engineer') {
        await api.patch(`/engineers/admin/engineers/${pwdTarget.id}/password`, { newPassword });
      } else {
        await api.patch(`/engineers/admin/operators/${pwdTarget.id}/password`, { newPassword });
      }
      message.success('密码重置成功');
      setPwdTarget(null);
      setNewPassword('');
    } catch (err: any) {
      message.error(err.response?.data?.message || '密码重置失败');
    }
  };

  const deleteEngineer = async (id: string) => {
    try {
      await api.delete(`/engineers/admin/engineers/${id}`);
      message.success('工程师账户已删除');
      await loadAccounts();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const deleteOperator = async (id: string) => {
    try {
      await api.delete(`/engineers/admin/operators/${id}`);
      message.success('运营账户已删除');
      await loadAccounts();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <Typography.Title level={5}>新增技术账户</Typography.Title>
      <Form form={engineerForm} layout="vertical" onFinish={handleCreateEngineer}>
        <AntSpace style={{ width: '100%' }} align="start">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true }]}>
            <Input.Password style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="level" label="工程师级别" rules={[{ required: true }]} initialValue="L1">
            <Select style={{ width: 120 }} options={[{ value: 'L1' }, { value: 'L2' }, { value: 'L3' }]} />
          </Form.Item>
          <Form.Item name="isAdmin" label=" " valuePropName="checked">
            <Checkbox>管理员工程师</Checkbox>
          </Form.Item>
          <Form.Item label=" ">
            <Button type="primary" htmlType="submit" loading={engLoading}>创建</Button>
          </Form.Item>
        </AntSpace>
      </Form>

      <Divider />

      <Typography.Title level={5}>新增运营账户</Typography.Title>
      <Form form={operatorForm} layout="vertical" onFinish={handleCreateOperator}>
        <AntSpace style={{ width: '100%' }} align="start">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true }]}>
            <Input.Password style={{ width: 180 }} />
          </Form.Item>
          <Form.Item label=" ">
            <Button type="primary" htmlType="submit" loading={opLoading}>创建</Button>
          </Form.Item>
        </AntSpace>
      </Form>

      <Divider />

      <Typography.Title level={5}>工程师账户列表</Typography.Title>
      <Table
        rowKey="id"
        loading={tableLoading}
        dataSource={engineers}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '邮箱', dataIndex: 'email' },
          { title: '级别', dataIndex: 'level', width: 90 },
          { title: '角色', dataIndex: 'role', width: 100 },
          { title: '可接单', dataIndex: 'isAvailable', width: 100, render: (v: boolean) => (v ? '是' : '否') },
          {
            title: '操作',
            width: 260,
            render: (_: any, row: any) => (
              <AntSpace>
                <Button
                  size="small"
                  onClick={() => {
                    setEditOperator(null);
                    setEditEngineer(row);
                    editForm.setFieldsValue({
                      username: row.username,
                      email: row.email,
                      level: row.level,
                      isAvailable: row.isAvailable,
                    });
                  }}
                >
                  修改信息
                </Button>
                <Button size="small" onClick={() => setPwdTarget({ type: 'engineer', id: row.id, username: row.username })}>
                  重置密码
                </Button>
                <Popconfirm title="确认删除该工程师账户？" onConfirm={() => deleteEngineer(row.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </AntSpace>
            ),
          },
        ]}
      />

      <Divider />

      <Typography.Title level={5}>运营账户列表</Typography.Title>
      <Table
        rowKey="id"
        loading={tableLoading}
        dataSource={operators}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '邮箱', dataIndex: 'email' },
          {
            title: '操作',
            width: 260,
            render: (_: any, row: any) => (
              <AntSpace>
                <Button
                  size="small"
                  onClick={() => {
                    setEditEngineer(null);
                    setEditOperator(row);
                    editForm.setFieldsValue({
                      username: row.username,
                      email: row.email,
                    });
                  }}
                >
                  修改信息
                </Button>
                <Button size="small" onClick={() => setPwdTarget({ type: 'operator', id: row.id, username: row.username })}>
                  重置密码
                </Button>
                <Popconfirm title="确认删除该运营账户？" onConfirm={() => deleteOperator(row.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </AntSpace>
            ),
          },
        ]}
      />

      <Divider />

      <Modal
        title={editEngineer ? '修改工程师信息' : '修改运营账户信息'}
        open={!!editEngineer || !!editOperator}
        onCancel={() => {
          setEditEngineer(null);
          setEditOperator(null);
          editForm.resetFields();
        }}
        onOk={submitEdit}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          {editEngineer && (
            <>
              <Form.Item name="level" label="工程师级别" rules={[{ required: true }]}>
                <Select options={[{ value: 'L1' }, { value: 'L2' }, { value: 'L3' }]} />
              </Form.Item>
              <Form.Item name="isAvailable" label="可接单" valuePropName="checked">
                <Checkbox>可接单</Checkbox>
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Modal
        title={`重置密码：${pwdTarget?.username || ''}`}
        open={!!pwdTarget}
        onCancel={() => {
          setPwdTarget(null);
          setNewPassword('');
        }}
        onOk={submitResetPassword}
      >
        <Input.Password
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="输入新密码"
        />
      </Modal>
    </div>
  );
}
