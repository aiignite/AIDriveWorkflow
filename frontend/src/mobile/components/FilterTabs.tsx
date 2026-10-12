import React from 'react';

interface Filter {
  key: string;
  label: string;
}

interface FilterTabsProps {
  filters: Filter[];
  activeKey: string;
  onChange: (key: string) => void;
  topClassName?: string;
  containerClassName?: string;
}

const FilterTabs: React.FC<FilterTabsProps> = ({
  filters,
  activeKey,
  onChange,
  topClassName = 'top-[108px]',
  containerClassName,
}) => (
  <div
    className={`sticky ${topClassName} z-20 bg-gray-50 dark:bg-gray-900 px-4 py-2 flex gap-2 overflow-x-auto border-b border-gray-100 dark:border-gray-800 scrollbar-hide ${containerClassName ?? ''}`}
  >
    {filters.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => onChange(key)}
        className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
          activeKey === key
            ? 'bg-blue-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

export default FilterTabs;
