/** Lightweight Canvas player for PixelForge atlases. Coordinates use exported pixels. */
export class SpritePlayer {
  static async load(canvas, atlasURL, options = {}) {
    const url = new URL(atlasURL, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load atlas: HTTP ${response.status}`);
    const atlas = await response.json();
    const image = new Image(); image.src = new URL(atlas.meta.image, url).href;
    await image.decode();
    return new SpritePlayer(canvas, image, atlas, options);
  }
  constructor(canvas, image, atlas, { scale = 1 } = {}) {
    if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new Error('Player scale must be an integer from 1 to 32');
    this.canvas = canvas; this.context = canvas.getContext('2d'); this.image = image; this.atlas = atlas;
    this.scale = scale; this.elapsed = 0; this.playing = false; this.animation = null; this.request = null;
    this.canvas.style.imageRendering = 'pixelated';
    this.tick = time => {
      if (!this.playing) return;
      this.elapsed += time - this.lastTime; this.lastTime = time; this.drawAt(this.elapsed);
      if (this.playing) this.request = requestAnimationFrame(this.tick);
    };
  }
  play(name, { restart = true } = {}) {
    if (!Object.hasOwn(this.atlas.animations, name)) throw new Error(`Unknown animation: ${name}`);
    const animation = this.atlas.animations[name];
    if (restart || this.animation !== animation) this.elapsed = 0;
    this.animation = animation; this.pause(); this.playing = true;
    this.lastTime = performance.now(); this.drawAt(this.elapsed);
    if (this.playing) this.request = requestAnimationFrame(this.tick);
    return this;
  }
  pause() { this.playing = false; if (this.request !== null) cancelAnimationFrame(this.request); this.request = null; return this; }
  resume() {
    if (!this.animation || this.playing) return this;
    if (!this.animation.loop && this.elapsed >= this.animation.duration) this.elapsed = 0;
    this.lastTime = performance.now(); this.playing = true; this.request = requestAnimationFrame(this.tick); return this;
  }
  drawAt(time) {
    const animation = this.animation;
    if (!animation) return;
    let elapsed = animation.loop ? time % animation.duration : Math.min(time, animation.duration);
    let selected = animation.frames.at(-1);
    for (const name of animation.frames) {
      if (elapsed < this.atlas.frames[name].duration) { selected = name; break; }
      elapsed -= this.atlas.frames[name].duration;
    }
    this.drawFrame(selected);
    if (!animation.loop && time >= animation.duration) this.pause();
  }
  drawFrame(name) {
    if (!Object.hasOwn(this.atlas.frames, name)) throw new Error(`Unknown frame: ${name}`);
    const entry = this.atlas.frames[name];
    const { x, y, w, h } = entry.frame;
    if (this.canvas.width !== w * this.scale) this.canvas.width = w * this.scale;
    if (this.canvas.height !== h * this.scale) this.canvas.height = h * this.scale;
    this.context.imageSmoothingEnabled = false;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(this.image, x, y, w, h, 0, 0, this.canvas.width, this.canvas.height);
  }
  destroy() { this.pause(); this.animation = null; }
}
