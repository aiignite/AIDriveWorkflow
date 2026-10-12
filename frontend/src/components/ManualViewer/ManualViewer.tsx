import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Download, Menu, Search, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface ManualSection {
  id: string;
  title: string;
  icon?: string;
  content: React.ReactNode;
}

export interface LegacyManualChapter {
  key?: string;
  id?: string;
  title: string;
  content?: React.ReactNode;
  component?: React.ComponentType;
}

export interface ManualData {
  id?: string;
  title: string;
  subtitle?: string;
  description?: string;
  version: string;
  lastUpdated?: string;
  sections?: ManualSection[];
  chapters?: LegacyManualChapter[];
}

export interface ManualViewerProps {
  show: boolean;
  onClose: () => void;
  manual: ManualData;
  isDark?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
const ManualViewer: React.FC<ManualViewerProps> = ({ show, onClose, manual, isDark = false }) => {
  const sections: ManualSection[] = (manual.sections ?? manual.chapters?.map((chapter, index) => ({
    id: chapter.id ?? chapter.key ?? `section-${index + 1}`,
    title: chapter.title,
    content: chapter.content ?? (chapter.component ? <chapter.component /> : null),
  })) ?? []);
  const manualSubtitle = manual.subtitle ?? manual.description ?? '';
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id ?? '');
  const [exporting, setExporting] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileTOC, setShowMobileTOC] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredSections = searchQuery.trim()
    ? sections.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sections;

  const activeSectionIndex = sections.findIndex(s => s.id === activeSection);

  /* ── 键盘快捷键 ── */
  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showMobileTOC) { setShowMobileTOC(false); return; }
        onClose();
      } else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        const next = sections[activeSectionIndex + 1];
        if (next) scrollToSection(next.id);
      } else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        const prev = sections[activeSectionIndex - 1];
        if (prev) scrollToSection(prev.id);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, onClose, activeSectionIndex, sections, showMobileTOC]);

  /* ── 禁止背景滚动 ── */
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [show]);

  /* ── 滚动监听 → 阅读进度 + 目录高亮 ── */
  useEffect(() => {
    if (!show) return;
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      /* 阅读进度 */
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = scrollHeight - clientHeight;
      setReadingProgress(maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0);
      /* 目录高亮 */
      const st = scrollTop + 120;
      let current = sections[0]?.id ?? '';
      for (const sec of sections) {
        const target = sectionRefs.current.get(sec.id);
        if (target && target.offsetTop <= st) current = sec.id;
      }
      setActiveSection(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [show, sections]);

  /* ── 滚动到章节 ── */
  const scrollToSection = useCallback((id: string) => {
    const target = sectionRefs.current.get(id);
    if (target && contentRef.current) {
      contentRef.current.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
    }
    setActiveSection(id);
    setShowMobileTOC(false);
  }, []);

  /* ── PDF 导出 ── */
  const exportPDF = useCallback(async () => {
    const el = contentRef.current;
    if (!el) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { default: jsPDF } = await import('jspdf');
      el.style.background = '#ffffff';
      el.style.color = '#111827';
      const canvas = await html2canvas(el, {
        scale: 1, useCORS: true, backgroundColor: '#ffffff',
        scrollY: -el.scrollTop, height: el.scrollHeight, windowHeight: el.scrollHeight,
      });
      el.style.background = '';
      el.style.color = '';
      const imgData = canvas.toDataURL('image/jpeg', 0.82);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const ratio = pdfW / canvas.width;
      const totalH = canvas.height * ratio;
      let pos = 0;
      while (pos < totalH) {
        if (pos > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -pos, pdfW, totalH);
        pos += pdfH;
      }
      pdf.save(`${manual.title}.pdf`);
    } catch { console.error('PDF 导出失败'); }
    finally { setExporting(false); }
  }, [manual.title]);

  if (!show) return null;

  const bg = isDark ? 'bg-gray-900' : 'bg-white';
  const textPrimary = isDark ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const sidebarBg = isDark ? 'bg-gray-800/90' : 'bg-gray-50';
  const hoverBg = isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100';
  const activeCls = isDark
    ? 'bg-blue-900/30 text-blue-400 border-r-2 border-blue-500'
    : 'bg-blue-50 text-blue-700 border-r-2 border-blue-600';

  const prevSection = sections[activeSectionIndex - 1];
  const nextSection = sections[activeSectionIndex + 1];

  /* ── 目录列表（公共渲染，桌面 + 移动端共用） ── */
  const TOCList = (
    <>
      {/* 搜索框 */}
      <div className="px-3 mb-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border ${isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}>
          <Search size={13} className={textSecondary} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="搜索章节…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={`flex-1 bg-transparent outline-none text-sm ${textPrimary} placeholder:${textSecondary}`}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className={`${textSecondary} hover:text-red-500`}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {/* 章节列表 */}
      <div className="flex-1 overflow-y-auto">
        {filteredSections.length === 0 ? (
          <p className={`px-4 py-3 text-sm ${textSecondary}`}>无匹配章节</p>
        ) : (
          filteredSections.map((sec, idx) => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => scrollToSection(sec.id)}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-all ${
                  isActive ? activeCls + ' font-medium' : `${textSecondary} ${hoverBg}`
                }`}
              >
                <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center shrink-0 font-bold ${
                  isActive
                    ? isDark ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'
                    : isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                }`}>
                  {idx + 1}
                </span>
                <span className="truncate">{sec.title}</span>
              </button>
            );
          })
        )}
      </div>
      {/* 上 / 下章节导航 */}
      <div className={`px-3 py-3 border-t ${borderColor} flex gap-2 shrink-0`}>
        <button
          disabled={!prevSection}
          onClick={() => prevSection && scrollToSection(prevSection.id)}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs transition-colors border ${
            prevSection
              ? isDark ? 'border-gray-600 hover:bg-gray-700 text-gray-300' : 'border-gray-200 hover:bg-gray-100 text-gray-600'
              : isDark ? 'border-gray-700 text-gray-600 cursor-default' : 'border-gray-100 text-gray-300 cursor-default'
          }`}
        >
          <ChevronLeft size={12} /> 上一章
        </button>
        <button
          disabled={!nextSection}
          onClick={() => nextSection && scrollToSection(nextSection.id)}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs transition-colors border ${
            nextSection
              ? isDark ? 'border-gray-600 hover:bg-gray-700 text-gray-300' : 'border-gray-200 hover:bg-gray-100 text-gray-600'
              : isDark ? 'border-gray-700 text-gray-600 cursor-default' : 'border-gray-100 text-gray-300 cursor-default'
          }`}
        >
          下一章 <ChevronRight size={12} />
        </button>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-[90] flex" style={{ backdropFilter: 'blur(4px)' }}>
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* 主面板 */}
      <div className={`relative flex flex-col w-full h-full ${bg} m-0 sm:m-4 sm:rounded-2xl sm:shadow-2xl overflow-hidden`}>

        {/* ── 阅读进度条 ── */}
        <div className="absolute top-0 left-0 right-0 h-0.5 z-10 bg-transparent">
          <div
            className="h-full bg-blue-500 transition-all duration-150"
            style={{ width: `${readingProgress}%` }}
          />
        </div>

        {/* ── 顶部标题栏 ── */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor} shrink-0`}>
          <div className="flex items-center gap-3 min-w-0">
            {/* 移动端汉堡菜单 */}
            <button
              className={`md:hidden p-2 rounded-lg ${hoverBg} ${textSecondary} shrink-0`}
              onClick={() => setShowMobileTOC(true)}
            >
              <Menu size={18} />
            </button>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-blue-900/30' : 'bg-blue-50'}`}>
              <BookOpen size={16} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
            </div>
            <div className="min-w-0">
              <h1 className={`text-base font-bold truncate ${textPrimary}`}>{manual.title}</h1>
              <p className={`text-xs ${textSecondary} hidden sm:block`}>{manualSubtitle} · {manual.version}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* 章节进度 */}
            <span className={`hidden sm:block text-xs ${textSecondary} tabular-nums`}>
              {activeSectionIndex + 1} / {sections.length}
            </span>
            {/* 阅读进度 % */}
            <span className={`hidden sm:block text-xs font-medium tabular-nums ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
              {readingProgress}%
            </span>
            <button
              onClick={exportPDF}
              disabled={exporting}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isDark ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              } disabled:opacity-50`}
            >
              <Download size={14} />
              <span className="hidden sm:inline">{exporting ? '导出中...' : '导出 PDF'}</span>
            </button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${hoverBg} ${textSecondary}`}
              title="关闭 (ESC)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 内容区 ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* 移动端目录抽屉 */}
          {showMobileTOC && (
            <div className="absolute inset-0 z-20 md:hidden flex">
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileTOC(false)} />
              <div className={`relative w-72 h-full flex flex-col ${sidebarBg} shadow-2xl`}>
                <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor} shrink-0`}>
                  <span className={`text-sm font-semibold ${textPrimary}`}>目录</span>
                  <button onClick={() => setShowMobileTOC(false)} className={`p-1 rounded ${hoverBg} ${textSecondary}`}>
                    <X size={16} />
                  </button>
                </div>
                <div className="flex flex-col flex-1 min-h-0 py-2">
                  {TOCList}
                </div>
              </div>
            </div>
          )}

          {/* 桌面端左侧目录 */}
          <nav className={`w-64 shrink-0 border-r ${borderColor} ${sidebarBg} flex flex-col py-3 hidden md:flex`}>
            <div className={`px-4 mb-2 text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>目录</div>
            <div className="flex flex-col flex-1 min-h-0">
              {TOCList}
            </div>
          </nav>

          {/* 右侧内容滚动区 */}
          <div
            ref={contentRef}
            id="manual-content"
            className="flex-1 overflow-y-auto px-6 py-6 md:px-12 md:py-8"
          >
            {/* 封面区域 */}
            <div className="mb-10 pb-8 border-b border-dashed border-gray-200 dark:border-gray-700">
              <h1 className={`text-3xl font-bold mb-2 ${textPrimary}`}>{manual.title}</h1>
              <p className={`text-lg ${textSecondary}`}>{manualSubtitle}</p>
              <p className={`text-sm mt-2 ${textSecondary}`}>版本：{manual.version}</p>
            </div>

            {/* 各章节 */}
            {sections.map(sec => (
              <section
                key={sec.id}
                ref={el => { if (el) sectionRefs.current.set(sec.id, el); }}
                className="mb-12"
              >
                <h2 className={`text-xl font-bold mb-4 pb-2 border-b-2 border-blue-100 text-blue-700 dark:border-blue-900 dark:text-blue-300`}>
                  {sec.title}
                </h2>
                <div className={`${textPrimary} leading-relaxed`}>{sec.content}</div>
              </section>
            ))}

            {/* 章节底部导航 */}
            <div className={`mt-10 pt-6 border-t ${borderColor} flex items-center justify-between`}>
              <button
                disabled={!prevSection}
                onClick={() => prevSection && scrollToSection(prevSection.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                  prevSection
                    ? isDark ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-600'
                    : 'opacity-0 pointer-events-none'
                }`}
              >
                <ChevronLeft size={16} />
                <span className="truncate max-w-[160px]">{prevSection?.title}</span>
              </button>
              <span className={`text-xs ${textSecondary}`}>
                {activeSectionIndex + 1} / {sections.length}
              </span>
              <button
                disabled={!nextSection}
                onClick={() => nextSection && scrollToSection(nextSection.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                  nextSection
                    ? isDark ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-600'
                    : 'opacity-0 pointer-events-none'
                }`}
              >
                <span className="truncate max-w-[160px]">{nextSection?.title}</span>
                <ChevronRight size={16} />
              </button>
            </div>

            {/* 页脚 */}
            <div className={`mt-8 pt-4 border-t ${borderColor} text-center ${textSecondary} text-xs`}>
              <p>— {manual.title} · {manual.version} —</p>
              <p className="mt-1">AIDriveWorkflow 工作流平台</p>
              <p className={`mt-2 ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
                ESC 关闭 · ⌘F 搜索 · ← → 切换章节
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualViewer;
