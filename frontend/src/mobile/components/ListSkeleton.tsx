import React from 'react';

interface ListSkeletonProps {
  count?: number;
}

const ListSkeleton: React.FC<ListSkeletonProps> = ({ count = 4 }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-1/2" />
      </div>
    ))}
  </>
);

export default ListSkeleton;
