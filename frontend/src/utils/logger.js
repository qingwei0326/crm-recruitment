/**
 * 统一日志工具
 * 开发环境输出到 console，生产环境静默
 */
const isDev = import.meta.env?.DEV;

export const logger = {
  log: (...args) => isDev && console.log('[CRM]', ...args),
  error: (...args) => console.error('[CRM]', ...args),
  warn: (...args) => isDev && console.warn('[CRM]', ...args),
};

export default logger;
