import { PixelBuffer } from './buffer.js';
import { P } from './palette.js';
import type { Overlay } from '@avo/shared';

/** 10x10 status icons. The scene always pairs them with a text label: color is never the only signal. */
export const ICON = 10;
const pal = { '#': P.ink, W: P.white, R: P.red2, r: P.red3, A: P.amber2, a: P.amber3, G: P.gray3, g: P.gray5, C: P.cyan2, c: P.cyan4, B: P.blue3, P: P.purple2, Y: P.amber1 };

const ART: Record<Overlay | 'think' | 'talk' | 'zzz' | 'meet', string[]> = {
  waiting: ['.########.', '#AAAAAAAA#', '.#WWWWWW#.', '..#WAAW#..', '...#WW#...', '...#AA#...', '..#AAAA#..', '.#AAAAAA#.', '#AAAAAAAA#', '.########.'],
  blocked: ['..######..', '.#RRRRRR#.', '#RRRRRRRR#', '#RWWWWWWR#', '#RWWWWWWR#', '#RRRRRRRR#', '#RRRRRRRR#', '.#RRRRRR#.', '..######..', '..........'],
  paused: ['.########.', '#BBBBBBBB#', '#BWWBBWWB#', '#BWWBBWWB#', '#BWWBBWWB#', '#BWWBBWWB#', '#BWWBBWWB#', '#BBBBBBBB#', '.########.', '..........'],
  error: ['....##....', '...#RR#...', '..#RWWR#..', '..#RWWR#..', '.#RRWWRR#.', '.#RRWWRR#.', '#RRRRRRRR#', '#RRRWWRRR#', '#RRRRRRRR#', '.########.'],
  offline: ['.########.', '#GGGGGGGG#', '#GWGGGGWG#', '#GGWGGWGG#', '#GGGWWGGG#', '#GGGWWGGG#', '#GGWGGWGG#', '#GWGGGGWG#', '#GGGGGGGG#', '.########.'],
  unknown: ['.########.', '#GGGGGGGG#', '#GGWWWWGG#', '#GGWGGWGG#', '#GGGGGWGG#', '#GGGWWGGG#', '#GGGWGGGG#', '#GGGGGGGG#', '#GGGWGGGG#', '.########.'],
  starting: ['.########.', '#CCCCCCCC#', '#CCWWWWCC#', '#CWCCCCWC#', '#CWCCCCCC#', '#CWCCCCCC#', '#CWCCCCWC#', '#CCWWWWCC#', '#CCCCCCCC#', '.########.'],
  stopping: ['.########.', '#GGGGGGGG#', '#GGGGGGGG#', '#GGWWWWGG#', '#GGWWWWGG#', '#GGWWWWGG#', '#GGWWWWGG#', '#GGGGGGGG#', '#GGGGGGGG#', '.########.'],
  think: ['..........', '...####...', '..#WWWW#..', '.#WWWWWW#.', '.#WGWGWG#.', '.#WWWWWW#.', '..######..', '..#.......', '.#........', '..........'],
  talk: ['..........', '.########.', '#WWWWWWWW#', '#WGWGWGWW#', '#WWWWWWWW#', '.###WW###.', '....#W#...', '.....##...', '..........', '..........'],
  zzz: ['..WWWWW...', '.....W....', '....W.....', '...WWWWW..', '..........', '......WWW.', '.......W..', '......WWW.', '..........', '..........'],
  meet: ['.########.', '#BBBBBBBB#', '#BWBWBWBB#', '#BBBBBBBB#', '#BWBWBWBB#', '#BBBBBBBB#', '.###BB###.', '....#B#...', '.....##...', '..........'],
};

export type IconKey = keyof typeof ART;
export function drawIcon(k: IconKey): PixelBuffer {
  const b = new PixelBuffer(ICON, ICON);
  b.stamp(0, 0, ART[k], pal);
  return b;
}
export const ICON_KEYS = Object.keys(ART) as IconKey[];
