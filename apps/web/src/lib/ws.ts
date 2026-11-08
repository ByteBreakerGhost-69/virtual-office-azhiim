import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_PREFIX, type AgentDTO, type DomainEvent, type WsServerMessage } from '@avo/shared';

/**
 * Realtime link. The socket only *patches the cache with data the server sent*; it never invents state.
 * While it is down, `live` is false and the UI shows a "data may be stale" indicator; on reconnect everything refetches.
 */
export function useRealtime(enabled: boolean): { live: boolean; lastMessageAt: number | null } {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const [lastMessageAt, setLast] = useState<number | null>(null);
  const attempt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let wasDown = false;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastSeen = Date.now();

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}${API_PREFIX}/ws`);
      ws.onopen = () => {
        attempt.current = 0;
        lastSeen = Date.now();
        setLive(true);
        if (wasDown) void qc.invalidateQueries(); // refetch everything after an outage
        wasDown = false;
      };
      ws.onmessage = (ev) => {
        lastSeen = Date.now();
        setLast(lastSeen);
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as WsServerMessage;
        } catch {
          return;
        }
        handle(msg);
      };
      ws.onclose = () => {
        setLive(false);
        wasDown = true;
        if (closed) return;
        const delay = Math.min(15_000, 500 * 2 ** attempt.current++) + Math.random() * 300;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    const handle = (msg: WsServerMessage) => {
      switch (msg.type) {
        case 'agent':
          qc.setQueryData<AgentDTO[]>(['agents'], (old) => {
            if (!old) return old;
            const i = old.findIndex((a) => a.id === msg.agent.id);
            if (i === -1) return [...old, msg.agent];
            const next = old.slice();
            next[i] = msg.agent;
            return next;
          });
          void qc.invalidateQueries({ queryKey: ['agent', msg.agent.id] });
          void qc.invalidateQueries({ queryKey: ['overview'] });
          void qc.invalidateQueries({ queryKey: ['organization'] });
          break;
        case 'agent.removed':
          qc.setQueryData<AgentDTO[]>(['agents'], (old) => old?.filter((a) => a.id !== msg.agentId));
          void qc.invalidateQueries({ queryKey: ['overview'] });
          break;
        case 'event':
          onEvent(msg.event);
          break;
        default:
          break;
      }
    };
    const onEvent = (e: DomainEvent) => {
      void qc.invalidateQueries({ queryKey: ['activity'] });
      if (e.type.startsWith('task.') || e.type === 'run.state.changed') {
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        if (e.taskId) void qc.invalidateQueries({ queryKey: ['task', e.taskId] });
        void qc.invalidateQueries({ queryKey: ['overview'] });
      }
      if (e.type.startsWith('approval.')) {
        void qc.invalidateQueries({ queryKey: ['approvals'] });
        void qc.invalidateQueries({ queryKey: ['overview'] });
      }
      if (e.type.startsWith('integration.') || e.type.startsWith('simulation.')) {
        void qc.invalidateQueries({ queryKey: ['integrations'] });
        void qc.invalidateQueries({ queryKey: ['agents'] });
        void qc.invalidateQueries({ queryKey: ['simulation'] });
      }
      if (e.type.startsWith('control.')) void qc.invalidateQueries({ queryKey: ['overview'] });
      window.dispatchEvent(new CustomEvent('avo:event', { detail: e }));
    };

    // The server pings every 15 s; silence for 40 s means the link is dead even if the browser has not noticed.
    watchdog = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastSeen > 40_000) ws.close();
    }, 5000);
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (watchdog) clearInterval(watchdog);
      ws?.close();
    };
  }, [enabled, qc]);

  return { live: enabled && live, lastMessageAt };
}
