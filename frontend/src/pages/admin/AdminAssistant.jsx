import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import AssistantPanel from '../../components/assistant/AssistantPanel';
import { useAssistant } from '../../context/AssistantContext';
import useIsMobile from '../../hooks/useIsMobile';

export default function AdminAssistant() {
  const assistant = useAssistant();
  const { initializeAssistant, setError } = assistant;
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    initializeAssistant().catch((error) => {
      setError(error.response?.data?.msg || error.message || '助手加载失败');
    });
  }, [initializeAssistant, setError]);

  return (
    <AdminLayout
      isMobile={isMobile}
      sidebarOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
    >
      <main className="flex h-[100dvh] min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title="AI 助手"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <div className="min-h-0 flex-1">
          <AssistantPanel fullPage />
        </div>
      </main>
    </AdminLayout>
  );
}
