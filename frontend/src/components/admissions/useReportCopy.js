import { useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import { copyText } from '../../utils/reportText';

// Copies a report to the clipboard and tells the agent. Call copyReport directly
// from the click handler so the browser still treats it as a user gesture.
export default function useReportCopy() {
  const toast = useToast();
  const auth = useAuth();
  const agentName = auth?.user?.name || '';

  const copyReport = useCallback((text) => {
    void copyText(text).then((ok) => {
      if (ok) toast?.success('已复制，可以直接粘贴到群里');
      else toast?.error('复制失败，请长按文字手动复制');
    });
  }, [toast]);

  return { agentName, copyReport };
}
