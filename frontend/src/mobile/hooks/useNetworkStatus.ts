import { useEffect, useState } from 'react';

export interface NetworkStatus {
  online: boolean;
  type?: 'wifi' | '4g' | '3g' | 'unknown';
}

export const useNetworkStatus = (): NetworkStatus => {
  const [status, setStatus] = useState<NetworkStatus>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  });

  useEffect(() => {
    const handleOnline = () => setStatus({ online: true });
    const handleOffline = () => setStatus({ online: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check connection type if available
    const connection = (navigator as any).connection;
    if (connection) {
      const updateType = () => {
        const type = connection.effectiveType;
        const typeMap: Record<string, 'wifi' | '4g' | '3g' | 'unknown'> = {
          '4g': '4g',
          '3g': '3g',
          '2g': '3g',
          'slow-2g': '3g',
        };
        setStatus((prev) => ({ ...prev, type: typeMap[type] || 'unknown' }));
      };
      updateType();
      connection.addEventListener('change', updateType);
      return () => {
        connection.removeEventListener('change', updateType);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
};
