'use client';

/**
 * Fetches ICE configuration from the signaling service.
 *
 * TURN credentials are minted server-side and are never part of the web bundle.
 * If the request fails, a public STUN server is used so direct connections still
 * work on permissive networks.
 */

import { useEffect, useState } from 'react';
import type { IceConfigResponse, IceServerConfig } from '@bchu/shared';
import { ICE_SERVERS_URL } from '@/lib/env';

const STUN_ONLY_FALLBACK: IceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export interface IceConfigState {
  iceServers: IceServerConfig[] | null;
  hasRelay: boolean;
  /** True when the fallback is in use, which makes strict networks likely to fail. */
  degraded: boolean;
}

export function useIceServers(): IceConfigState {
  const [state, setState] = useState<IceConfigState>({
    iceServers: null,
    hasRelay: false,
    degraded: false,
  });

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(ICE_SERVERS_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);

        const config = (await response.json()) as IceConfigResponse;
        setState({
          iceServers: config.iceServers ?? STUN_ONLY_FALLBACK,
          hasRelay: Boolean(config.hasRelay),
          degraded: false,
        });
      } catch {
        if (controller.signal.aborted) return;
        setState({ iceServers: STUN_ONLY_FALLBACK, hasRelay: false, degraded: true });
      }
    })();

    return () => controller.abort();
  }, []);

  return state;
}
