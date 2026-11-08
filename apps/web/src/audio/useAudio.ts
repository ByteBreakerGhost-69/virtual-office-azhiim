import { useSyncExternalStore } from 'react';
import { audio } from './engine.js';

let snap = { ...audio.prefs };
audio.subscribe(() => {
  snap = { ...audio.prefs };
});
export function useAudio() {
  const prefs = useSyncExternalStore(
    (cb) => audio.subscribe(cb),
    () => snap,
  );
  return { ...prefs, setMusic: (v: boolean) => audio.setMusic(v), setSfx: (v: boolean) => audio.setSfx(v), play: audio.play.bind(audio) };
}
