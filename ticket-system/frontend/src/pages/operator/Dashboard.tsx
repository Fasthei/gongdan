import React from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography } from 'antd';
import {
  UnorderedListOutlined, TeamOutlined, LogoutOutlined, DashboardOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import TicketList from './TicketList';
import CustomerManage from './CustomerManage';
import StatusBoard from './StatusBoard';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

export default function OperatorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/staff/login'); };

  const menuItems = [
    { key: '/operator', icon: <UnorderedListOutlined />, label: <Link to="/operator">工单管理</Link> },
    { key: '/operator/customers', icon: <TeamOutlined />, label: <Link to="/operator/customers">客户管理</Link> },
    { key: '/operator/status', icon: <DashboardOutlined />, label: <Link to="/operator/status">服务状态</Link> },
    { key: '/kb-chat', icon: <DashboardOutlined />, label: <Link to="/kb-chat">WBChat Agent</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={240} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '24px 16px', fontWeight: 'bold', fontSize: 18, color: '#1a73e8' }}>
          运营后台
        </div>
        <Menu theme="light" mode="inline" selectedKeys={[location.pathname]} items={menuItems} style={{ borderRight: 'none' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
          <Text>欢迎，{user?.username}</Text>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
        </Header>
        <Content style={{ margin: 24 }}>
          <Routes>
            <Route path="/" element={<TicketList />} />
            <Route path="/customers" element={<CustomerManage />} />
            <Route path="/status" element={<StatusBoard />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
