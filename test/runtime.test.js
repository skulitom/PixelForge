import test from 'node:test';
import assert from 'node:assert/strict';
import { SpritePlayer } from '../src/runtime.js';

test('Canvas player respects durations, once/loop behavior, pause/resume and scaled atlas rectangles', t => {
  let sequence = 0; const pending = new Map();
  const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { const id = ++sequence; pending.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  t.after(() => { if (originalRAF) globalThis.requestAnimationFrame = originalRAF; else delete globalThis.requestAnimationFrame; if (originalCancel) globalThis.cancelAnimationFrame = originalCancel; else delete globalThis.cancelAnimationFrame; });
  const draws = [], ctx = { clearRect() {}, drawImage(...args) { draws.push(args); } };
  const canvas = { width: 0, height: 0, style: {}, getContext() { return ctx; } };
  const atlas = {
    frames: { a: { frame: { x: 2, y: 4, w: 8, h: 12 }, duration: 80 }, b: { frame: { x: 12, y: 4, w: 8, h: 12 }, duration: 120 } },
    animations: { once: { frames: ['a','b'], duration: 200, loop: false }, loop: { frames: ['a','b'], duration: 200, loop: true } }
  };
  const player = new SpritePlayer(canvas, {}, atlas, { scale: 3 });
  player.play('once'); assert.equal(pending.size, 1);
  assert.equal(canvas.width, 24); assert.equal(canvas.height, 36); assert.equal(ctx.imageSmoothingEnabled, false);
  player.drawAt(79); assert.equal(draws.at(-1)[1], 2);
  player.drawAt(80); assert.equal(draws.at(-1)[1], 12);
  player.drawAt(200); assert.equal(draws.at(-1)[1], 12); assert.equal(player.playing, false); assert.equal(pending.size, 0);
  player.play('loop'); player.drawAt(200); assert.equal(draws.at(-1)[1], 2);
  player.pause(); assert.equal(pending.size, 0); player.resume(); player.resume(); assert.equal(pending.size, 1);
  player.play('loop'); assert.equal(pending.size, 1);
  assert.throws(() => player.play('missing'), /Unknown animation/);
  assert.throws(() => player.play('toString'), /Unknown animation/);
  player.destroy(); assert.equal(pending.size, 0); assert.equal(player.animation, null);
});
