import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider, PromptProvider } from './components/ConfirmDialog';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30 秒内数据视为新鲜
      gcTime: 5 * 60_000,       // 5 分钟后清理未使用的缓存
      retry: 1,                 // 失败重试 1 次
      refetchOnWindowFocus: false, // 切换窗口不自动刷新
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
          <ToastProvider><ConfirmProvider><PromptProvider><AuthProvider>
            <App />
          </AuthProvider></PromptProvider></ConfirmProvider></ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
