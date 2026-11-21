import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client.js';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export function useLogStream() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    // Initial fetch of recent logs
    api
      .get<{ data?: LogEntry[] } | LogEntry[]>('/api/logs/recent')
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as { data?: LogEntry[] }).data || [];
        setLogs(list.slice(-100));
      })
      .catch(() => {});

    // Open Server-Sent Events stream
    if (typeof EventSource !== 'undefined') {
      try {
        const es = new EventSource('/api/logs/stream');
        eventSourceRef.current = es;

        es.onopen = () => {
          setIsConnected(true);
        };

        es.onmessage = (event) => {
          if (isPaused) return;
          try {
            const data = JSON.parse(event.data);
            const entry: LogEntry = {
              id: data.id || `${Date.now()}-${Math.random()}`,
              timestamp: data.timestamp || new Date().toISOString(),
              level: data.level || 'info',
              message: typeof data === 'string' ? data : data.message || JSON.stringify(data),
            };

            setLogs((prev) => [...prev.slice(-200), entry]);
          } catch {
            const entry: LogEntry = {
              id: `${Date.now()}-${Math.random()}`,
              timestamp: new Date().toISOString(),
              level: 'info',
              message: event.data,
            };
            setLogs((prev) => [...prev.slice(-200), entry]);
          }
        };

        es.onerror = () => {
          setIsConnected(false);
        };
      } catch {
        setIsConnected(false);
      }
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isPaused]);

  return {
    logs,
    isConnected,
    isPaused,
    setIsPaused,
    clearLogs,
  };
}
