import { useCallback, useRef } from 'react';

/**
 * 提取自 11 处重复的 setTimeout+setActionMsg 模式。
 * 自动清除上一次 timer，避免快速连续调用时的竞态。
 */
export default function useFlashMessage(actions) {
  const timerRef = useRef(null);

  const flashMsg = useCallback((msg) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    actions.setActionMsg(msg);
    timerRef.current = setTimeout(() => {
      actions.setActionMsg('');
      timerRef.current = null;
    }, 2000);
  }, [actions]);

  return flashMsg;
}
