// A draw loop: a slime hops, squashing before the jump and on landing. Ordinary Canvas 2D code, compiled to pixel art
// with `pixelforge compile examples/slime.loop.mjs`. The landing is a timeline cue, so it starts a frame and its
// position reaches the atlas; `feet` is a point on every frame for game code.
import { ease } from '../src/craft.js';

// Centred on a pixel centre (x.5), as crisp canvas code is, so the one-pixel outline is symmetric.
const X = 24.5, GROUND = 40, RADIUS = 9;
// Phases in seconds: crouch, jump, fall, land squash, recover.
const shape = t => {
  if (t < 0.15) { const k = ease('out', t / 0.15); return { lift: 0, sx: 1 + 0.25 * k, sy: 1 - 0.25 * k }; }
  if (t < 0.6) {
    const k = (t - 0.15) / 0.45, height = 18 * 4 * k * (1 - k), stretch = 0.2 * (1 - Math.abs(2 * k - 1));
    return { lift: height, sx: 1 - stretch * 0.6, sy: 1 + stretch };
  }
  if (t < 0.75) { const k = ease('out', (t - 0.6) / 0.15); return { lift: 0, sx: 1 + 0.35 * (1 - k * 0.4), sy: 1 - 0.35 * (1 - k * 0.4) }; }
  const k = ease('overshoot', (t - 0.75) / 0.15);
  return { lift: 0, sx: 1.21 - 0.21 * k, sy: 0.79 + 0.21 * k };
};

export default {
  name: 'slime', width: 48, height: 48,
  palette: { s: '#22202e', G: '#2f6b4a', g: '#4fb06a', l: '#b7f0a1', k: '#14131c' },
  timeline: { length: 900, rate: 12, cues: { land: { time: 600, at: [24, 40] } } },
  draw(ctx, t) {
    const { lift, sx, sy } = shape(t);
    // The shadow shrinks and fades as the slime rises; partial alpha dithers.
    const away = Math.min(1, lift / 18);
    ctx.fillStyle = `rgba(34, 32, 46, ${0.9 - 0.5 * away})`;
    ctx.beginPath(); ctx.ellipse(X, GROUND + 0.5, RADIUS * sx * (1 - 0.35 * away), 2.5, 0, 0, Math.PI * 2); ctx.fill();

    // Squash and stretch from the feet: scale around the bottom centre of the body.
    ctx.save();
    ctx.translate(X, GROUND - lift);
    ctx.scale(sx, sy);
    ctx.beginPath();
    ctx.moveTo(-RADIUS, 0);
    ctx.bezierCurveTo(-RADIUS, -RADIUS * 1.5, RADIUS, -RADIUS * 1.5, RADIUS, 0);
    ctx.closePath();
    ctx.fillStyle = '#4fb06a'; ctx.fill();
    ctx.strokeStyle = '#2f6b4a'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#b7f0a1';
    ctx.beginPath(); ctx.ellipse(-3.5, -7.5, 2, 1.2, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#14131c';
    ctx.fillRect(-4.5, -6, 2, 3); ctx.fillRect(2.5, -6, 2, 3);
    ctx.restore();
    ctx.point('feet', X, GROUND - lift);
  }
};
