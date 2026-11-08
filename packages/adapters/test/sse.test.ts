import { describe, expect, it } from 'vitest';
import { SseParser, type SseMessage } from '../src/sse.js';

const collect = (chunks: string[]) => {
  const out: SseMessage[] = [];
  const comments: string[] = [];
  const p = new SseParser((m) => out.push(m), (c) => comments.push(c));
  for (const c of chunks) p.push(c);
  p.end();
  return { out, comments };
};

describe('SseParser', () => {
  it('parses named events with data', () => {
    expect(collect(['event: tool.started\ndata: {"tool":"x"}\n\n']).out).toEqual([{ event: 'tool.started', data: '{"tool":"x"}' }]);
  });
  it('handles events split across chunk boundaries', () => {
    const { out } = collect(['event: message.de', 'lta\nda', 'ta: {"delta":"hi"}\n', '\n']);
    expect(out).toEqual([{ event: 'message.delta', data: '{"delta":"hi"}' }]);
  });
  it('handles CRLF and multi-line data', () => {
    expect(collect(['event: a\r\ndata: one\r\ndata: two\r\n\r\n']).out[0]).toEqual({ event: 'a', data: 'one\ntwo' });
  });
  it('surfaces keepalive comments without emitting events', () => {
    const { out, comments } = collect([': keepalive\n\n']);
    expect(out).toEqual([]);
    expect(comments).toEqual(['keepalive']);
  });
  it('discards an incomplete trailing event', () => {
    expect(collect(['event: a\ndata: x']).out).toEqual([]);
  });
  it('defaults the event name to "message"', () => {
    expect(collect(['data: hi\n\n']).out[0]?.event).toBe('message');
  });
});
