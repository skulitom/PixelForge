// A draw loop: ordinary Canvas 2D code, compiled to pixel art with `pixelforge compile examples/lantern.loop.mjs`.
// The lantern's form is an authored sprite; code supplies the swing, the rope and the light. In a browser the same
// draw function paints a smooth version. Colours are CSS; the palette holds the same colours, so each maps to its key.
import { sinDeg, cosDeg } from '../src/craft.js';

const PERIOD = 1.6, SWING = 24, HOOK = [24, 1], ROPE = 15;

export default {
  name: 'lantern', width: 48, height: 48,
  palette: { k: '#1d1b29', i: '#4b4560', u: '#8c6c4c', d: '#4a2a26', r: '#9a4a2c', o: '#e0863a', y: '#f6c45e', w: '#fff3c4' },
  // Light: keys from dim to bright. Glows add up along it and end in hard bands; light under a fifth of full stays
  // dark (the floor sets how far a glow reaches), and the flame shimmers frame to frame.
  ramps: [{ keys: ['d', 'r', 'o', 'y', 'w'], floor: 0.2, breakup: 0.12, cluster: 2, flicker: true }],
  symbols: {
    lantern: [
      '..kkk..',
      '.k...k.',
      'kkkkkkk',
      'kiyyyik',
      'kyowoyk',
      'kyowoyk',
      'kiyyyik',
      'kkkkkkk',
      '.kkkkk.'
    ]
  },
  timeline: { length: 1600, rate: 10 },
  draw(ctx, t) {
    // The swing in degrees, and the glass centre where rotate() will put it (rope length plus half the sprite).
    const angle = SWING * cosDeg(360 * t / PERIOD), radians = angle * Math.PI / 180, reach = ROPE + 4;
    const x = HOOK[0] + 0.5 + reach * sinDeg(angle), y = HOOK[1] + reach * cosDeg(angle);
    const flicker = 1 + 0.06 * sinDeg(360 * t * 3.3) + 0.04 * sinDeg(360 * t * 7.1);

    ctx.globalCompositeOperation = 'lighter';
    // Light pool on the floor: a circular gradient squashed by scale() into an ellipse under the lantern.
    ctx.save();
    ctx.translate(x, 44); ctx.scale(1, 0.25);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
    pool.addColorStop(0, 'rgba(224, 134, 58, 0.6)');
    pool.addColorStop(1, 'rgba(224, 134, 58, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Halo around the glass: bright near the flame, cooling outward.
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 12 * flicker);
    halo.addColorStop(0, 'rgba(246, 196, 94, 0.85)');
    halo.addColorStop(0.45, 'rgba(224, 134, 58, 0.45)');
    halo.addColorStop(1, 'rgba(224, 134, 58, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x - 13, y - 13, 26, 26);
    ctx.globalCompositeOperation = 'source-over';

    // Rope and lantern turn together around the hook.
    ctx.save();
    ctx.translate(HOOK[0], HOOK[1]);
    ctx.rotate(-radians);
    ctx.strokeStyle = '#8c6c4c';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.lineTo(0.5, ROPE - 0.5); ctx.stroke();
    ctx.drawImage('lantern', -3, ROPE - 0.5);
    ctx.restore();
    ctx.point('light', x, y);
  }
};
