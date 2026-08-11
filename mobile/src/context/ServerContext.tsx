import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import {
  clearServerConnection,
  deriveWsUrl,
  loadServerConnection,
  saveServerConnection,
  type ServerConnection,
} from '../services/serverConfig';

type ServerContextValue = {
  // undefined = still loading persisted state; null = loaded, nothing paired yet
  connection: ServerConnection | null | undefined;
  wsUrl: string | null;
  pair: (connection: ServerConnection) => Promise<void>;
  unpair: () => Promise<void>;
};

const ServerContext = createContext<ServerContextValue | null>(null);

export const ServerProvider = ({ children }: PropsWithChildren) => {
  const [connection, setConnection] = useState<ServerConnection | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadServerConnection().then((loaded) => {
      if (!cancelled) setConnection(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pair = useCallback(async (next: ServerConnection) => {
    await saveServerConnection(next);
    setConnection(next);
  }, []);

  const unpair = useCallback(async () => {
    await clearServerConnection();
    setConnection(null);
  }, []);

  const wsUrl = useMemo(
    () => (connection ? deriveWsUrl(connection.baseUrl) : null),
    [connection]
  );

  const value = useMemo(
    () => ({ connection, wsUrl, pair, unpair }),
    [connection, wsUrl, pair, unpair]
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
};

export const useServerContext = (): ServerContextValue => {
  const ctx = useContext(ServerContext);
  if (!ctx) {
    throw new Error('useServerContext must be used within a ServerProvider');
  }
  return ctx;
};
