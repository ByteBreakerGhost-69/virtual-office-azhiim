import type { WsServerMessage } from '@avo/shared';

export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

/** Workspace-scoped broadcast hub for authenticated WebSocket clients. */
export class Hub {
  private readonly rooms = new Map<string, Set<HubSocket>>();

  add(workspaceId: string, socket: HubSocket): () => void {
    let set = this.rooms.get(workspaceId);
    if (!set) this.rooms.set(workspaceId, (set = new Set()));
    set.add(socket);
    return () => set?.delete(socket);
  }

  broadcast(workspaceId: string, msg: WsServerMessage): void {
    const set = this.rooms.get(workspaceId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const s of [...set]) {
      try {
        if (s.readyState === 1) s.send(data);
        else set.delete(s);
      } catch {
        set.delete(s);
      }
    }
  }

  ping(serverTime: string): void {
    for (const ws of this.rooms.keys()) this.broadcast(ws, { type: 'ping', serverTime });
  }

  connectionCount(workspaceId?: string): number {
    if (workspaceId) return this.rooms.get(workspaceId)?.size ?? 0;
    let n = 0;
    for (const s of this.rooms.values()) n += s.size;
    return n;
  }

  closeAll(): void {
    for (const set of this.rooms.values()) for (const s of set) s.close(1001, 'server shutting down');
    this.rooms.clear();
  }
}
