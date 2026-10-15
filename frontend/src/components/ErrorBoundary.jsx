import { Component } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { isChunkLoadError } from '../utils/lazyWithRetry';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // A page script that failed to download is a network problem, not a bug:
      // say so in plain words instead of showing the raw browser message.
      const networkProblem = isChunkLoadError(this.state.error);
      const Icon = networkProblem ? WifiOff : AlertTriangle;
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-panel shadow-lg border dark:border-gray-700 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
              <Icon className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {networkProblem ? '网络不稳，页面没加载完整' : '页面出了点问题'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {networkProblem
                ? '请确认手机或电脑已联网，再点下面的按钮重试。已保存的内容不会丢。'
                : this.state.error?.message || '发生了未知错误，请尝试刷新页面'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {networkProblem ? '重新加载' : '刷新页面'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
