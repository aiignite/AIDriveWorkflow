/**
 * 工作流管理 使用说明书
 */
import type { ManualData } from '../components/ManualViewer/ManualViewer';

const s = {
  h3: 'text-base font-semibold text-gray-800 dark:text-gray-100 mt-4 mb-2',
  p: 'text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-2',
  ul: 'list-disc list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1 mb-3',
  table: 'w-full text-sm border-collapse my-4',
  th: 'text-left px-3 py-2 bg-gray-100 dark:bg-gray-700 font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600',
  td: 'px-3 py-2 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300',
  tip: 'mt-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-800 dark:text-blue-300',
  warn: 'mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-300',
};

export const workflowManual: ManualData = {
  title: '工作流管理',
  subtitle: '流程定义、实例管理与任务审批',
  version: '1.0',
  lastUpdated: '2025-06',
  sections: [
    {
      id: 'overview',
      title: '功能概述',
      icon: '🔀',
      content: (
        <div>
          <p className={s.p}>
            工作流管理模块提供可视化的业务流程设计与执行平台，支持变更审批、文档评审、零件发布等多类流程，
            实现企业流程的标准化、自动化流转。
          </p>
          <div className="grid grid-cols-2 gap-3 my-4">
            {[
              { icon: '📋', label: '流程定义', desc: '新建、设计、发布流程模板' },
              { icon: '▶️', label: '流程实例', desc: '启动并跟踪流程执行进度' },
              { icon: '✅', label: '我的任务', desc: '查看并处理待办审批任务' },
              { icon: '📊', label: '统计看板', desc: '可视化流程运行数据分析' },
            ].map(item => (
              <div key={item.label} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="text-2xl">{item.icon}</span>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{item.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
          <img src="/manuals/workflow/list.jpeg" alt="工作流管理界面" className="w-full rounded-lg border border-gray-200 dark:border-gray-700 object-cover" />
          <p className={s.tip}>💡 系统内置多种常用流程模板（ECR审批、文档评审、零件发布等），可一键快速创建，无需从零配置。</p>
        </div>
      ),
    },
    {
      id: 'definition',
      title: '流程定义管理',
      icon: '📐',
      content: (
        <div>
          <h3 className={s.h3}>流程定义列表</h3>
          <p className={s.p}>流程定义列表展示所有已创建（包含草稿、已发布、已归档）的工作流模板。</p>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>字段</th>
                <th className={s.th}>说明</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['流程名称', '流程定义的标识名称，应简洁描述业务场景'],
                ['分类', '变更管理 / 文档审批 / 零件发布 / 设计评审 / 偏差处理 / 自定义'],
                ['版本', '流程模板的版本号，发布后版本自动升级'],
                ['状态', '草稿（可编辑）/ 已发布（可启动）/ 已归档（只读）'],
                ['说明', '流程用途的详细描述'],
              ].map(([f, d]) => (
                <tr key={f}><td className={s.td}>{f}</td><td className={s.td}>{d}</td></tr>
              ))}
            </tbody>
          </table>

          <h3 className={s.h3}>新建流程定义</h3>
          <ol className="list-decimal list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1 mb-3">
            <li>点击右上角 <strong>新建流程定义</strong></li>
            <li>选择流程分类（或使用"快速创建"选择内置模板）</li>
            <li>填写流程名称与描述，保存为草稿</li>
            <li>在流程设计器中编辑节点与连线，配置审批人</li>
            <li>确认无误后点击 <strong>发布</strong>，流程进入可启动状态</li>
          </ol>
          <p className={s.tip}>💡 推荐优先使用内置模板（ECR变更、ECO实施、文档评审等），在模板基础上修改更高效。</p>
        </div>
      ),
    },
    {
      id: 'designer',
      title: '流程设计器',
      icon: '🎨',
      content: (
        <div>
          <p className={s.p}>流程设计器支持可视化拖拽编辑流程图，配置每个节点的审批人、超时处理等属性。</p>

          <h3 className={s.h3}>节点类型</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>节点类型</th>
                <th className={s.th}>用途</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['开始节点', '流程的起始点，每个流程只有一个'],
                ['审批节点', '需要指定用户/角色完成审批操作'],
                ['会签节点', '需要多人全部审批通过后才能继续'],
                ['条件网关', '根据条件判断走不同分支路径'],
                ['结束节点', '流程终止点，执行结束动作'],
              ].map(([n, d]) => (
                <tr key={n}><td className={s.td}>{n}</td><td className={s.td}>{d}</td></tr>
              ))}
            </tbody>
          </table>

          <h3 className={s.h3}>操作步骤</h3>
          <ul className={s.ul}>
            <li>从左侧面板将节点类型拖入画布</li>
            <li>点击节点可在右侧面板配置：审批人员、超时时间、节点说明</li>
            <li>拖拽节点端口连接有向边，建立流转关系</li>
            <li>点击"保存设计"持久化，点击"发布"激活流程</li>
          </ul>
          <p className={s.warn}>⚠️ 已发布的流程定义不能直接修改，需先归档后新建版本，或撤回重新编辑。</p>
        </div>
      ),
    },
    {
      id: 'instance',
      title: '流程实例管理',
      icon: '▶️',
      content: (
        <div>
          <p className={s.p}>流程实例是流程定义的一次具体执行过程，记录了整个流程从发起到结束的完整轨迹。</p>

          <h3 className={s.h3}>启动流程</h3>
          <ol className="list-decimal list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1 mb-3">
            <li>在流程定义列表，点击已发布流程后的 <strong>启动</strong> 按钮</li>
            <li>填写业务关联单号（如 ECR 编号、文档编号）</li>
            <li>确认后系统自动推送任务通知给首个审批人</li>
          </ol>

          <h3 className={s.h3}>实例状态</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>状态</th>
                <th className={s.th}>说明</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['运行中', '流程正在正常流转，等待某节点审批'],
                ['已完成', '所有节点均审批通过，流程正常结束'],
                ['已终止', '管理员强制终止或业务条件触发终止'],
                ['已挂起', '临时暂停，等待额外信息或外部处理'],
              ].map(([st, d]) => (
                <tr key={st}><td className={s.td}>{st}</td><td className={s.td}>{d}</td></tr>
              ))}
            </tbody>
          </table>
          <p className={s.tip}>💡 点击实例行可查看详细的节点进度、历史审批记录和流程图高亮显示。</p>
        </div>
      ),
    },
    {
      id: 'tasks',
      title: '我的任务',
      icon: '✅',
      content: (
        <div>
          <p className={s.p}>
            "我的任务"列表展示当前用户需要处理的所有审批/任务节点，包括待处理和已处理两类。
          </p>

          <h3 className={s.h3}>任务处理流程</h3>
          <ol className="list-decimal list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1 mb-3">
            <li>在"我的任务"或"待处理"列表找到目标任务</li>
            <li>点击"处理"进入任务详情页</li>
            <li>查看业务单据内容，填写审批意见</li>
            <li>选择 <strong>同意 / 拒绝 / 退回</strong>，提交后流程自动流转</li>
          </ol>

          <h3 className={s.h3}>任务状态说明</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>状态</th>
                <th className={s.th}>含义</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['待处理', '分配给我，尚未领取或处理'],
                ['处理中', '已领取，正在填写审批意见'],
                ['已完成', '审批动作已执行（同意/拒绝/退回）'],
                ['已取消', '流程终止或被重新分配，任务失效'],
              ].map(([st, d]) => (
                <tr key={st}><td className={s.td}>{st}</td><td className={s.td}>{d}</td></tr>
              ))}
            </tbody>
          </table>
          <p className={s.warn}>⚠️ 请及时处理超时预警的任务（橙色标记），避免影响业务流程的正常推进。</p>
        </div>
      ),
    },
    {
      id: 'faq',
      title: '常见问题',
      icon: '❓',
      content: (
        <div className="space-y-4">
          {[
            {
              q: '如何修改已发布的流程定义？',
              a: '已发布的流程不能直接修改。需先将其"归档"，然后基于原流程新建新版本，编辑并重新发布。',
            },
            {
              q: '流程启动后发现信息填写错误，如何处理？',
              a: '联系管理员手动终止当前实例，修正业务单据后重新启动流程。在审批完成前退回也可重新提交。',
            },
            {
              q: '多个审批人同时收到任务，谁审批？',
              a: '若为"会签"节点，所有人均需审批；若为"或签"节点，任意一人审批即可流转；具体取决于流程设计时的节点类型配置。',
            },
            {
              q: '我没有收到审批任务通知，怎么办？',
              a: '进入"我的任务"页面检查是否有待处理任务；确认账号是否被正确设置为该流程节点的审批人；如仍无数据，联系管理员核查流程配置。',
            },
          ].map(({ q, a }) => (
            <div key={q} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Q: {q}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">A: {a}</p>
            </div>
          ))}
        </div>
      ),
    },
  ],
};
