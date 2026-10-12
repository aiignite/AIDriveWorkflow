/**
 * 工作流定义 category 中文标签 — 与 backend/app/seed_workflows.py 内置模板对齐。
 * 筛选下拉应使用 value=英文 key、label=中文，避免与列表「分类」列不一致。
 */
export const WORKFLOW_CATEGORY_LABELS: Record<string, string> = {
  change_management: '变更管理',
  document: '文档审批',
  design_review: '设计评审',
  deviation: '偏差处理',
  custom: '自定义',
  functional_safety: '功能安全',
  material: '物料',
  req_elicitation_confirm: '需求采集确认',
  sys_req_review: '系统需求评审',
  sys_int_test_review: '系统集成测试评审',
  sys_qual_test_review: '系统合格性测试评审',
  swe_req_review: '软件需求评审',
  swe_arch_review: '软件架构评审',
  swe_detail_review: '软件详细设计评审',
  swe_unit_review: '软件单元测试评审',
  swe_integration_review: '软件集成测试评审',
  swe_qualification_review: '软件合格性测试评审',
  problem_management: '问题管理',
  product_demand: '产品需求',
  process: '工艺',
  project: '项目',
  equipment: '设备',
  product_dev: '产品开发',
  ai: 'AI / 治理',
  manufacturing: '制造',
  quality: '质量',
  scheduling: '排产 APS',
  contract: '合同',
  governance: '组织治理',
  simulation: '工厂仿真',
  ehs: 'EHS',
};

export const WORKFLOW_CATEGORY_COLORS: Record<string, string> = {
  change_management: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  document: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  design_review: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  deviation: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  custom: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  functional_safety: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  material: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  req_elicitation_confirm: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  sys_req_review: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  sys_int_test_review: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  sys_qual_test_review: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  swe_req_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  swe_arch_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  swe_detail_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  swe_unit_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  swe_integration_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  swe_qualification_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  problem_management: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  product_demand: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  process: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
  project: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  equipment: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
  product_dev: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  ai: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
  manufacturing: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  quality: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  scheduling: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  contract: 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400',
  governance: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400',
  simulation: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  ehs: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

export function getWorkflowCategoryLabel(category: string | null | undefined): string {
  if (!category) return '未分类';
  return WORKFLOW_CATEGORY_LABELS[category] || category;
}

export function getWorkflowCategoryColor(category: string | null | undefined): string {
  if (!category) return WORKFLOW_CATEGORY_COLORS.custom;
  return WORKFLOW_CATEGORY_COLORS[category] || WORKFLOW_CATEGORY_COLORS.custom;
}

/** 筛选下拉：已知标签 + 当前已加载定义里出现的 category（防 Seed 新增遗漏） */
export function buildWorkflowCategoryFilterOptions(
  definitions: Array<{ category?: string | null }>,
): Array<{ value: string; label: string }> {
  const keys = new Set<string>(Object.keys(WORKFLOW_CATEGORY_LABELS));
  for (const defn of definitions) {
    if (defn.category) keys.add(defn.category);
  }
  return Array.from(keys)
    .sort((a, b) => getWorkflowCategoryLabel(a).localeCompare(getWorkflowCategoryLabel(b), 'zh-CN'))
    .map((value) => ({ value, label: getWorkflowCategoryLabel(value) }));
}
