import { Application } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { OfficeScene } from './scene.js';
import type { OfficeCanvasProps } from './types.js';

const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

/**
 * React wrapper around the PixiJS scene. The scene only ever receives AgentDTOs from the backend;
 * a visually hidden list mirrors every character so keyboard/screen-reader users (and tests) can reach them.
 */
export function OfficeCanvas(props: OfficeCanvasProps) {
  const { agents, selectedAgentId, onSelectAgent, filter, labels, reducedMotion, avatarEnabled, live, onSfx, className } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const cbRef = useRef({ onSelectAgent, onSfx, onAvatarRest: props.onAvatarRest });
  cbRef.current = { onSelectAgent, onSfx, onAvatarRest: props.onAvatarRest };
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const app = new Application();
    (async () => {
      await app.init({ resizeTo: host, background: 0x0a1024, antialias: false, roundPixels: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      host.appendChild(app.canvas);
      app.canvas.style.display = 'block';
      app.canvas.setAttribute('aria-hidden', 'true');
      const p = latest.current;
      const scene = new OfficeScene(app, host, {
        onSelect: (id) => cbRef.current.onSelectAgent(id),
        onSfx: (n) => cbRef.current.onSfx?.(n),
        labels: p.labels,
        reducedMotion: p.reducedMotion,
        onAvatarRest: (pose) => cbRef.current.onAvatarRest?.(pose),
      });
      scene.setAvatarStart(p.avatarStart ?? null);
      sceneRef.current = scene;
      scene.setFilter(p.filter);
      scene.setLive(p.live);
      scene.setAvatarEnabled(p.avatarEnabled);
      scene.setAgents(p.agents);
      scene.setSelected(p.selectedAgentId);
      setReady(true);
    })().catch((err) => console.error('office init failed', err));
    return () => {
      disposed = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      try {
        app.destroy(true, { children: true });
      } catch {
        /* init may not have completed */
      }
    };
  }, []);

  useEffect(() => void sceneRef.current?.setLabels(labels), [labels, ready]);
  useEffect(() => void sceneRef.current?.setReducedMotion(reducedMotion), [reducedMotion, ready]);
  useEffect(() => void sceneRef.current?.setFilter(filter), [filter, ready]);
  useEffect(() => void sceneRef.current?.setLive(live), [live, ready]);
  useEffect(() => void sceneRef.current?.setAvatarStart(props.avatarStart ?? null), [props.avatarStart, ready]);
  useEffect(() => void sceneRef.current?.setAvatarEnabled(avatarEnabled), [avatarEnabled, ready]);
  useEffect(() => void sceneRef.current?.setSelected(selectedAgentId), [selectedAgentId, ready]);
  useEffect(() => void sceneRef.current?.setAgents(agents), [agents, ready]);

  const visibleAgents = agents.filter((a) => filter === 'ALL' || a.mode === filter);
  const btn = 'pointer-events-auto grid h-8 w-8 place-items-center rounded border border-[var(--c-border,#aab3c4)] bg-white/90 text-base font-bold text-[#141b2d] hover:bg-white';
  return (
    <div className={className ?? 'relative h-full w-full'} style={{ minHeight: 240 }}>
      <div ref={hostRef} data-testid="office-canvas" data-ready={ready} data-live={live} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button type="button" className={btn} aria-label={labels.zoomIn} title={labels.zoomIn} onClick={() => sceneRef.current?.zoom(1.3)}>+</button>
        <button type="button" className={btn} aria-label={labels.zoomOut} title={labels.zoomOut} onClick={() => sceneRef.current?.zoom(1 / 1.3)}>−</button>
        <button type="button" className={btn} aria-label={labels.zoomReset} title={labels.zoomReset} onClick={() => sceneRef.current?.zoom('reset')}>⌖</button>
      </div>
      <ul aria-label={labels.agentListLabel} style={srOnly}>
        {visibleAgents.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              data-testid={`office-agent-${a.id}`}
              data-agent-state={a.state}
              data-agent-mode={a.mode}
              data-agent-room={a.placement.room}
              data-agent-pose={a.placement.pose}
              data-agent-overlay={a.placement.overlay ?? ''}
              aria-pressed={a.id === selectedAgentId}
              onClick={() => onSelectAgent(a.id)}
            >
              {a.name} — {a.mode === 'REAL' ? labels.real : labels.simulated} — {labels.states[a.state]} — {labels.roomNames[a.placement.room]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
