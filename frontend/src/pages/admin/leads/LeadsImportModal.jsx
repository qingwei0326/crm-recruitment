import { Download, Loader2, Upload, X } from 'lucide-react';

export default function LeadsImportModal({
  file,
  result,
  importing,
  onClose,
  onFileChange,
  onImport,
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-panel shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Excel 批量导入</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="text-sm bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg">
            Excel需包含列：<b>姓名</b>、<b>电话</b>、成绩、监护人姓名、监护人电话、学校名称、地域（可选），仅支持 .xlsx
          </div>
          <a href="/api/students/template/download" className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            <Download className="w-3.5 h-3.5" />下载Excel模板
          </a>
          <input type="file" accept=".xlsx" onChange={(e) => onFileChange(e.target.files[0])} className="w-full text-sm" />
          {file && <div className="text-sm">已选择: <b>{file.name}</b></div>}
          <button
            type="button"
            onClick={onImport} disabled={!file || importing}
            className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {importing ? (<><Loader2 className="w-4 h-4 animate-spin" />导入中…</>) : (<><Upload className="w-4 h-4" />开始导入</>)}
          </button>
          {result && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm">
              <div className="text-green-600">成功: {result.success} 条</div>
              <div className="text-amber-600">跳过: {result.skipped} 条</div>
              {Number(result.no_phone || 0) > 0 && (
                <div className="mt-1 text-red-600">
                  无电话数据: {result.no_phone} 条
                </div>
              )}
              {result.no_phone_rows?.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto rounded border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                  {result.no_phone_rows.slice(0, 8).map((row) => (
                    <div key={`${row.row}-${row.name || ''}`}>
                      第 {row.row} 行{row.name ? ` · ${row.name}` : ''}: 无电话数据
                    </div>
                  ))}
                  {result.no_phone_rows.length > 8 && (
                    <div>还有 {result.no_phone_rows.length - 8} 条未显示</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
