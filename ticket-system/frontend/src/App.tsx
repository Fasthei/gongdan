import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider } from './contexts/AuthContext';
import { PrivateRoute } from './components/PrivateRoute';

// 懒加载页面
const CustomerLogin = React.lazy(() => import('./pages/CustomerLogin'));
const StaffLogin = React.lazy(() => import('./pages/StaffLogin'));
const CustomerTicketList = React.lazy(() => import('./pages/customer/TicketList'));
const CustomerTicketDetail = React.lazy(() => import('./pages/customer/TicketDetail'));
const CustomerCreateTicket = React.lazy(() => import('./pages/customer/CreateTicket'));
const OperatorDashboard = React.lazy(() => import('./pages/operator/Dashboard'));
const EngineerDashboard = React.lazy(() => import('./pages/engineer/Dashboard'));
const KnowledgeBaseChat = React.lazy(() => import('./pages/common/KnowledgeBaseChat'));

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <AuthProvider>
        <BrowserRouter>
          <React.Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>}>
            <Routes>
              {/* 公开路由 */}
              <Route path="/login" element={<CustomerLogin />} />
              <Route path="/staff/login" element={<StaffLogin />} />
              <Route path="/" element={<Navigate to="/login" replace />} />

              {/* 客户路由 */}
              <Route path="/tickets" element={<PrivateRoute roles={['CUSTOMER']}><CustomerTicketList /></PrivateRoute>} />
              <Route path="/tickets/new" element={<PrivateRoute roles={['CUSTOMER']}><CustomerCreateTicket /></PrivateRoute>} />
              <Route path="/tickets/:id" element={<PrivateRoute roles={['CUSTOMER']}><CustomerTicketDetail /></PrivateRoute>} />

              {/* 运营路由 */}
              <Route path="/operator/*" element={<PrivateRoute roles={['OPERATOR']}><OperatorDashboard /></PrivateRoute>} />

              {/* 工程师路由 */}
              <Route path="/engineer/*" element={<PrivateRoute roles={['ENGINEER', 'ADMIN']}><EngineerDashboard /></PrivateRoute>} />

              {/* 全角色知识库对话 */}
              <Route path="/kb-chat" element={<PrivateRoute roles={['CUSTOMER', 'OPERATOR', 'ENGINEER', 'ADMIN']}><KnowledgeBaseChat /></PrivateRoute>} />

              <Route path="/unauthorized" element={<div style={{ padding: 40 }}>无权访问此页面</div>} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </React.Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}

export default App;
