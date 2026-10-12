import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  meta?: string;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  clearLabel?: string;
  emptyLabel?: string;
  isDark: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  /** 紧凑触发器（窄侧栏内用） */
  compact?: boolean;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '请选择...',
  searchPlaceholder = '输入关键词搜索...',
  clearLabel = '清空选择',
  emptyLabel = '没有匹配项',
  isDark,
  disabled = false,
  allowClear = true,
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find(option => option.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter(option => `${option.label} ${option.meta ?? ''}`.toLowerCase().includes(normalizedQuery))
    : options;

  const updateMenuPosition = () => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 220);
    let left = rect.left;
    // 防止超出视口右侧
    if (left + minWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - minWidth - 8);
    }
    setMenuRect({
      top: rect.bottom + 4,
      left,
      width: minWidth,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('resize', onScrollOrResize);
    // capture scroll from any ancestor (属性面板 overflow-y-auto)
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const closePanel = () => {
    setOpen(false);
    setQuery('');
  };

  const menu = open && menuRect
    ? createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuRect.top,
            left: menuRect.left,
            width: menuRect.width,
            zIndex: 9999,
          }}
          className={`overflow-hidden rounded-xl border shadow-xl ${
            isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
          }`}
        >
          <div className={`border-b p-2 ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className={`w-full rounded-md border py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-blue-500/30 ${
                  isDark ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {allowClear && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  closePanel();
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                  isDark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {clearLabel}
              </button>
            )}

            {filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  closePanel();
                }}
                className={`w-full px-3 py-2 text-left transition-colors ${
                  value === option.value
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                    : isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span className="block truncate text-sm font-medium">{option.label}</span>
                {option.meta && (
                  <span className={`block truncate text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {option.meta}
                  </span>
                )}
              </button>
            ))}

            {filteredOptions.length === 0 && (
              <div className={`px-3 py-4 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {emptyLabel}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapperRef} className="relative w-full min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(current => !current);
        }}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border text-left outline-none transition-colors focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'
        } ${
          isDark ? 'bg-gray-900 border-gray-600 text-white hover:border-gray-500' : 'bg-white border-gray-300 text-gray-900 hover:border-gray-400'
        }`}
      >
        <span className={`truncate min-w-0 ${selected ? '' : 'text-gray-400 dark:text-gray-500'}`}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown size={compact ? 14 : 16} className={`text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
};

export default SearchableSelect;
