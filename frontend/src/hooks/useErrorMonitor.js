import { useEffect } from 'react';
import api from '../api';
import logger from '../utils/logger';

/**
 * 全局错误监控 Hook
 * 捕获未处理的错误和 Promise rejection，上报到后端
 */
export default function useErrorMonitor() {
  useEffect(() => {
    // 捕获未处理的 JS 错误
    const handleError = (event) => {
      const error = event.error;
      if (!error) return;

      logger.error('Unhandled error:', error);

      // 上报到后端
      api.post('/admin/error-report', {
        type: 'javascript',
        message: error.message || 'Unknown error',
        stack: error.stack || '',
        url: window.location.href,
        userAgent: navigator.userAgent,
      }).catch(() => {});
    };

    // 捕获未处理的 Promise rejection
    const handleUnhandledRejection = (event) => {
      const error = event.reason;
      if (!error) return;

      logger.error('Unhandled rejection:', error);

      api.post('/admin/error-report', {
        type: 'promise',
        message: error.message || String(error),
        stack: error.stack || '',
        url: window.location.href,
        userAgent: navigator.userAgent,
      }).catch(() => {});
    };

    // 捕获资源加载失败
    const handleResourceError = (event) => {
      const target = event.target;
      if (!target || !target.tagName) return;

      const tagName = target.tagName.toLowerCase();
      if (tagName !== 'img' && tagName !== 'script' && tagName !== 'link') return;

      logger.error('Resource load error:', target.src || target.href);

      api.post('/admin/error-report', {
        type: 'resource',
        message: `Failed to load ${tagName}: ${target.src || target.href}`,
        url: window.location.href,
      }).catch(() => {});
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleResourceError, true);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleResourceError, true);
    };
  }, []);
}
