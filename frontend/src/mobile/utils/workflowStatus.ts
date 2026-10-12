export const getTaskStatusText = (status?: string): string => {
  switch (status) {
    case 'pending':
      return '待认领';
    case 'claimed':
      return '处理中';
    case 'in_progress':
      return '处理中';
    case 'completed':
      return '已完成';
    case 'rejected':
      return '已驳回';
    default:
      return status || '未知';
  }
};

export const getTaskStatusColor = (status?: string): string => {
  switch (status) {
    case 'pending':
      return 'bg-gray-100 text-gray-600';
    case 'claimed':
    case 'in_progress':
      return 'bg-blue-100 text-blue-600';
    case 'completed':
      return 'bg-green-100 text-green-600';
    case 'rejected':
      return 'bg-red-100 text-red-600';
    default:
      return 'bg-gray-100 text-gray-500';
  }
};

export const getInstanceStatusText = (status?: string): string => {
  switch (status) {
    case 'in_progress':
      return '进行中';
    case 'completed':
      return '已完成';
    case 'rejected':
      return '已驳回';
    case 'terminated':
      return '已终止';
    default:
      return status || '未知';
  }
};

export const getInstanceStatusColor = (status?: string): string => {
  switch (status) {
    case 'in_progress':
      return 'bg-blue-100 text-blue-600';
    case 'completed':
      return 'bg-green-100 text-green-600';
    case 'rejected':
      return 'bg-red-100 text-red-600';
    case 'terminated':
      return 'bg-gray-100 text-gray-600';
    default:
      return 'bg-gray-100 text-gray-500';
  }
};
