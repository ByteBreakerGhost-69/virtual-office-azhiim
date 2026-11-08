/**
 * Minimal, spec-following Server-Sent Events parser (WHATWG HTML §9.2).
 * Handles CRLF / LF / lone CR, multi-line `data:`, comments (`: keepalive`) and events split across chunks.
 * Events with a name but no data are still delivered (data = '') because some servers send bare names.
 * An event that is still incomplete when the stream ends is discarded, as the spec requires.
 */
export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export class SseParser {
  private buf = '';
  private eventName = '';
  private dataLines: string[] = [];
  private lastId: string | undefined;
  private pendingId: string | undefined;

  constructor(
    private readonly onMessage: (m: SseMessage) => void,
    private readonly onComment?: (comment: string) => void,
  ) {}

  push(chunk: string): void {
    this.buf += chunk;
    const b = this.buf;
    let i = 0;
    for (;;) {
      let j = i;
      while (j < b.length && b[j] !== '\n' && b[j] !== '\r') j++;
      if (j >= b.length) break;
      if (b[j] === '\r') {
        // A CR at the very end may be the first half of CRLF: wait for the next chunk.
        if (j + 1 >= b.length) break;
        const line = b.slice(i, j);
        i = b[j + 1] === '\n' ? j + 2 : j + 1;
        this.processLine(line);
      } else {
        const line = b.slice(i, j);
        i = j + 1;
        this.processLine(line);
      }
    }
    this.buf = b.slice(i);
  }

  /** Call when the underlying stream ended. */
  end(): void {
    if (this.buf.length > 0) {
      const line = this.buf.endsWith('\r') ? this.buf.slice(0, -1) : this.buf;
      this.buf = '';
      this.processLine(line);
    }
    // Discard any incomplete event.
    this.eventName = '';
    this.dataLines = [];
    this.pendingId = undefined;
  }

  get lastEventId(): string | undefined {
    return this.lastId;
  }

  private processLine(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) {
      this.onComment?.(line.slice(1).trimStart());
      return;
    }
    const idx = line.indexOf(':');
    let field: string;
    let value: string;
    if (idx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, idx);
      value = line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }
    switch (field) {
      case 'event':
        this.eventName = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.pendingId = value;
        break;
      default:
        break; // retry and unknown fields are ignored
    }
  }

  private dispatch(): void {
    if (this.pendingId !== undefined) this.lastId = this.pendingId;
    this.pendingId = undefined;
    if (this.dataLines.length === 0 && !this.eventName) {
      return;
    }
    const msg: SseMessage = { event: this.eventName || 'message', data: this.dataLines.join('\n') };
    if (this.lastId !== undefined) msg.id = this.lastId;
    this.eventName = '';
    this.dataLines = [];
    this.onMessage(msg);
  }
}
