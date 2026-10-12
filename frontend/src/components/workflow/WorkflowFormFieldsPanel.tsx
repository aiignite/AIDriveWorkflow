import { Calendar, Download, FileText, Hash, List, Loader2, MessageSquare, ToggleLeft, Type, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { filesApi } from '../../services/files';
import type { WorkflowFormField } from '../../types';

export interface WorkflowFileValue {
  documentId: string;
  fileName?: string;
}

function parseFileValue(value: unknown): WorkflowFileValue | null {
  if (!value) return null;
  if (typeof value === 'string') return { documentId: value };
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const documentId = (obj.documentId || obj.document_id) as string | undefined;
    if (documentId) {
      return { documentId, fileName: (obj.fileName || obj.file_name) as string | undefined };
    }
  }
  return null;
}

interface WorkflowFormFieldsPanelProps {
  fields: WorkflowFormField[];
  formData: Record<string, unknown>;
  isDark: boolean;
  readonly?: boolean;
  onChange?: (next: Record<string, unknown>) => void;
  title?: string;
  businessEntityType?: string;
  businessEntityId?: string;
}

const FIELD_ICONS: Record<string, LucideIcon> = {
  text: Type,
  textarea: MessageSquare,
  select: List,
  number: Hash,
  date: Calendar,
  checkbox: ToggleLeft,
  file: FileText,
};

const WorkflowFormFieldsPanel: React.FC<WorkflowFormFieldsPanelProps> = ({
  fields,
  formData,
  isDark,
  readonly = false,
  onChange,
  title = '表单数据',
  businessEntityType,
  businessEntityId,
}) => {
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const inputBg = isDark
    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
    : 'bg-white border-gray-300 text-gray-900';

  const handleFileUpload = async (fieldKey: string, file: File) => {
    if (readonly || !onChange) return;
    setUploadingField(fieldKey);
    try {
      const uploaded = await filesApi.upload(file);
      onChange({
        ...formData,
        [fieldKey]: { documentId: uploaded.id, fileName: file.name },
      });
      toast.success('文件已上传');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploadingField(null);
    }
  };

  if (fields.length === 0) return null;

  return (
    <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
      <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        <FileText size={15} className="text-blue-500" /> {title}
      </h3>
      <div className="space-y-3">
        {fields.map(field => {
          const fieldValue = formData[field.field];
          const isReadonly = readonly || field.readonly;
          const FieldIcon = FIELD_ICONS[field.type] || Type;

          return (
            <div key={field.field}>
              <label className={`flex items-center gap-1.5 text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                <FieldIcon size={12} />
                {field.label}
                {field.required && <span className="text-red-500">*</span>}
              </label>

              {field.type === 'file' ? (
                <div className="space-y-2">
                  {(() => {
                    const fileValue = parseFileValue(fieldValue);
                    if (fileValue) {
                      return (
                        <div className={`flex items-center gap-2 p-2 rounded-lg border text-sm ${isDark ? 'border-gray-600 bg-gray-700/40' : 'border-gray-200 bg-white'}`}>
                          <FileText size={14} className="text-indigo-500 flex-shrink-0" />
                          <span className={`flex-1 truncate ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                            {fileValue.fileName || fileValue.documentId}
                          </span>
                          <button
                            type="button"
                            onClick={() => filesApi.download(fileValue.documentId, fileValue.fileName)}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-indigo-900/30 text-indigo-400' : 'hover:bg-indigo-50 text-indigo-600'}`}
                            title="下载"
                          >
                            <Download size={14} />
                          </button>
                          {!isReadonly && onChange && (
                            <button
                              type="button"
                              onClick={() => onChange({ ...formData, [field.field]: undefined })}
                              className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-500'}`}
                              title="移除"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      );
                    }

                    if (isReadonly) {
                      return (
                        <div className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          未上传
                        </div>
                      );
                    }

                    return (
                      <>
                        <input
                          ref={el => { fileInputRefs.current[field.field] = el; }}
                          type="file"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) void handleFileUpload(field.field, file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          disabled={uploadingField === field.field}
                          onClick={() => fileInputRefs.current[field.field]?.click()}
                          className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border ${
                            isDark
                              ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                              : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                          } disabled:opacity-50`}
                        >
                          {uploadingField === field.field
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Upload size={14} />}
                          {uploadingField === field.field ? '上传中...' : '选择文件'}
                        </button>
                      </>
                    );
                  })()}
                </div>
              ) : field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={(fieldValue as string) || ''}
                  onChange={e => onChange?.({ ...formData, [field.field]: e.target.value })}
                  readOnly={isReadonly}
                  placeholder={field.placeholder || ''}
                  className={`w-full px-3 py-2 text-sm rounded-lg border resize-none ${inputBg} ${isReadonly ? 'opacity-70' : ''}`}
                />
              ) : field.type === 'select' ? (
                <select
                  value={(fieldValue as string) || ''}
                  onChange={e => onChange?.({ ...formData, [field.field]: e.target.value })}
                  disabled={isReadonly}
                  className={`w-full px-3 py-2 text-sm rounded-lg border ${inputBg} ${isReadonly ? 'opacity-70' : ''}`}
                >
                  <option value="">请选择...</option>
                  {(field.options || []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : field.type === 'number' ? (
                <input
                  type="number"
                  value={(fieldValue as number) ?? ''}
                  onChange={e => onChange?.({ ...formData, [field.field]: parseFloat(e.target.value) || 0 })}
                  readOnly={isReadonly}
                  placeholder={field.placeholder || ''}
                  className={`w-full px-3 py-2 text-sm rounded-lg border ${inputBg} ${isReadonly ? 'opacity-70' : ''}`}
                />
              ) : field.type === 'date' ? (
                <input
                  type="date"
                  value={(fieldValue as string) || ''}
                  onChange={e => onChange?.({ ...formData, [field.field]: e.target.value })}
                  readOnly={isReadonly}
                  className={`w-full px-3 py-2 text-sm rounded-lg border ${inputBg} ${isReadonly ? 'opacity-70' : ''}`}
                />
              ) : field.type === 'checkbox' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!fieldValue}
                    onChange={e => onChange?.({ ...formData, [field.field]: e.target.checked })}
                    disabled={isReadonly}
                    className="w-4 h-4 rounded"
                  />
                  <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{field.label}</span>
                </div>
              ) : field.type === 'radio' ? (
                <div className="flex flex-wrap gap-3">
                  {(field.options || []).map(opt => (
                    <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name={field.field}
                        value={opt.value}
                        checked={fieldValue === opt.value}
                        onChange={e => onChange?.({ ...formData, [field.field]: e.target.value })}
                        disabled={isReadonly}
                        className="w-4 h-4"
                      />
                      <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  value={(fieldValue as string) || ''}
                  onChange={e => onChange?.({ ...formData, [field.field]: e.target.value })}
                  readOnly={isReadonly}
                  placeholder={field.placeholder || ''}
                  className={`w-full px-3 py-2 text-sm rounded-lg border ${inputBg} ${isReadonly ? 'opacity-70' : ''}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowFormFieldsPanel;
