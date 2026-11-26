/**
 * Routes. Unchanged from before the Spike redesign except that the Shell now lives in
 * layout/FullLayout.tsx (Spike's floating sidebar + header).
 */
import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './session';
import { ToastHost } from './ui';
import { FullLayout } from './layout/FullLayout';
import { Login, Register, ChangePassword } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const People = lazy(() => import('./pages/People'));
const Employee = lazy(() => import('./pages/Employee'));
const Org = lazy(() => import('./pages/Org'));
const Time = lazy(() => import('./pages/Time'));
const Leave = lazy(() => import('./pages/Leave'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Payroll = lazy(() => import('./pages/Payroll'));
const PayRun = lazy(() => import('./pages/PayRun'));
const Payslips = lazy(() => import('./pages/Payslips'));
const Helpdesk = lazy(() => import('./pages/Helpdesk'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Audit = lazy(() => import('./pages/Audit'));
const Security = lazy(() => import('./pages/Security'));
const Access = lazy(() => import('./pages/Access'));
const Integrations = lazy(() => import('./pages/Integrations'));

export function App() {
  return (
    <BrowserRouter>
      <ToastHost>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/account/password" element={<ChangePassword />} />
            <Route element={<FullLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<Employee />} />
              <Route path="org" element={<Org />} />
              <Route path="time" element={<Time />} />
              <Route path="leave" element={<Leave />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="payroll" element={<Payroll />} />
              <Route path="payroll/:id" element={<PayRun />} />
              <Route path="payslips" element={<Payslips />} />
              <Route path="helpdesk" element={<Helpdesk />} />
              <Route path="helpdesk/:id" element={<Helpdesk />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="audit" element={<Audit />} />
              <Route path="settings/security" element={<Security />} />
              <Route path="settings/access" element={<Access />} />
              <Route path="settings/integrations" element={<Integrations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </SessionProvider>
      </ToastHost>
    </BrowserRouter>
  );
}
