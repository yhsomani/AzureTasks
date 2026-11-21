import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { UserSession } from '../types/index.js';

export function useSession() {
  const [session, setSession] = useState<UserSession>({
    authenticated: false,
    user: 'operator',
    role: 'developer',
    viewerMode: false,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<UserSession>('/api/session')
      .then((data) => {
        if (active && data) {
          setSession({
            authenticated: !!data.authenticated,
            user: data.user || 'operator',
            role: (data.role as UserSession['role']) || 'developer',
            viewerMode: !!data.viewerMode,
          });
        }
      })
      .catch(() => {
        // Fallback default
        if (active) {
          setSession({
            authenticated: true,
            user: 'local-operator',
            role: 'admin',
            viewerMode: false,
          });
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return {
    session,
    isLoading,
    isViewer: session.viewerMode,
    canMutate: !session.viewerMode,
  };
}
