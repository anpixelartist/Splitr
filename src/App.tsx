import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { GroupDetails } from './pages/GroupDetails';
import { LoginPage } from './pages/LoginPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GroupProvider } from './context/GroupContext';
import { ToastProvider } from './context/ToastContext';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  // AuthProvider already hides children while loading (renders null)
  if (!user) return <LoginPage />;
  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <GroupProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/group/:id" element={<RequireAuth><GroupDetails /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </BrowserRouter>
      </GroupProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
