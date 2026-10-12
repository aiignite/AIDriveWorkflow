import { useEffect, useRef, useState } from 'react';

interface UsePaginationProps {
  onLoadMore: () => Promise<void>;
  threshold?: number;
}

export const usePagination = ({ onLoadMore, threshold = 200 }: UsePaginationProps) => {
  const observerTarget = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      async (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          setIsLoading(true);
          try {
            await onLoadMore();
          } finally {
            setIsLoading(false);
          }
        }
      },
      { rootMargin: `${threshold}px` }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [isLoading, onLoadMore, threshold]);

  return { observerTarget, isLoading };
};
