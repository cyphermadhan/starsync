// Adapted from Canvas UI's "Particle Reveal" component
// (https://canvasui.dev/docs/components/particle-reveal) — same shader and
// reveal/dust math, but re-targeted at a plain static image instead of their
// generic "capture live HTML" approach.
//
// Why: their version renders arbitrary DOM into the canvas via the
// experimental "html-in-canvas" API (`drawElementImage`/`layoutsubtree`).
// That API is currently a Chrome-only origin trial gated behind manually
// enabling chrome://flags/#canvas-draw-element — effectively invisible to
// real visitors. Our content is just one background photo, so we don't need
// live-DOM capture at all: we upload the image directly into a WebGL2
// texture, which works in any WebGL2-capable browser (all current major
// browsers). If WebGL2 itself is unavailable, `createParticleReveal` returns
// null and the caller should fall back to a plain <img>.

export interface ParticleRevealOptions {
  radius?: number;
  softness?: number;
  size?: number;
  scatter?: number;
  drift?: number;
  aberration?: number;
  bend?: number;
  fade?: number;
  threshold?: number;
  background?: string;
  smoothing?: number;
}

export interface ParticleRevealElements {
  /** Already-loaded image (call `.decode()` before passing it in). */
  image: HTMLImageElement;
  /** Canvas the effect renders to; sized via CSS, matched to its own devicePixelRatio internally. */
  output: HTMLCanvasElement;
}

export interface ParticleRevealInstance {
  setOptions: (options: ParticleRevealOptions) => void;
  destroy: () => void;
}

const DEFAULTS: Required<ParticleRevealOptions> = {
  radius: 500,
  softness: 0.75,
  size: 1,
  scatter: 25,
  drift: 1,
  aberration: 40,
  bend: 50,
  fade: 0.85,
  threshold: 0.1,
  background: '#000000',
  smoothing: 0.25,
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Same dust/reveal math as the original, except `samp()` now maps canvas
// pixels onto the image texture with a CSS `background-size: cover`-style
// crop (via uImgSize/uRes) instead of assuming a 1:1 capture-to-canvas size.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform vec2 uRes;
uniform vec2 uImgSize;
uniform float uDpr;
uniform vec2 uPointer;
uniform float uActive;
uniform float uRadius;
uniform float uSoftness;
uniform float uSize;
uniform float uScatter;
uniform float uDrift;
uniform float uAberration;
uniform float uBend;
uniform float uFade;
uniform float uThreshold;
uniform vec3 uBg;
uniform float uTime;
uniform float uCrisp;

float hash (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 samp (vec2 p) {
  vec2 uv = p / uRes;
  float canvasAspect = uRes.x / uRes.y;
  float imgAspect = uImgSize.x / uImgSize.y;
  if (imgAspect > canvasAspect) {
    float scale = canvasAspect / imgAspect;
    uv.x = (uv.x - 0.5) * scale + 0.5;
  } else {
    float scale = imgAspect / canvasAspect;
    uv.y = (uv.y - 0.5) * scale + 0.5;
  }
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  return texture(uContent, uv);
}

void main () {
  vec2 pc = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  if (uCrisp > 0.5) {
    outColor = samp(pc);
    return;
  }

  float dist = length(pc - uPointer);
  float radius = max(uRadius, 1.0);
  float inner = radius * (1.0 - clamp(uSoftness, 0.02, 1.0));
  float e = (1.0 - smoothstep(inner, radius, dist)) * uActive;

  float band = radius * 0.9;
  float ring = smoothstep(inner, radius, dist)
    * (1.0 - smoothstep(radius, radius + band, dist))
    * uActive;

  vec2 dir = (pc - uPointer) / max(dist, 1e-3);
  vec2 tang = vec2(-dir.y, dir.x);
  vec2 warp = (dir * -1.0 + tang * 0.6) * uBend * ring;
  float ca = uAberration * ring;

  float cellPx = max(uSize, 0.5) * uDpr;
  vec2 cell = floor(gl_FragCoord.xy / cellPx);
  float n1 = hash(cell);
  float n2 = hash(cell + vec2(3.1, 7.7));
  float n3 = hash(cell + vec2(9.3, 1.3));
  float ft = floor(uTime * (2.0 + uDrift * 6.0));
  float n4 = hash(cell + vec2(ft * 0.613, ft * 0.831));

  float g0 = uThreshold * 0.6;
  float g1 = uThreshold * 1.6 + 0.01;
  vec3 lw = vec3(0.299, 0.587, 0.114);

  vec2 bp = pc + warp;
  vec4 bR = samp(bp + dir * ca);
  vec4 bC = samp(bp);
  vec4 bB = samp(bp - dir * ca);
  vec3 baseRgb = vec3(bR.r, bC.g, bB.b);
  float uiHome = smoothstep(g0, g1, dot(abs(baseRgb - uBg), lw));

  float rad = uScatter * pow(n1, 2.5) * (1.0 - e);
  float ang = n2 * 6.2832 + uTime * uDrift * (0.5 + n3 * 1.5);
  vec2 dustP = bp + vec2(cos(ang), sin(ang)) * rad;

  vec4 dR = samp(dustP + dir * ca);
  vec4 dC = samp(dustP);
  vec4 dB = samp(dustP - dir * ca);
  vec3 dustRgb = vec3(dR.r, dC.g, dB.b);
  float lumD = dot(dustRgb, lw);
  float dDust = dot(abs(dustRgb - uBg), lw);

  float gate = smoothstep(g0, g1, dDust);
  float falloff = 1.0 - 0.7 * rad / max(uScatter, 1.0);
  float prob = clamp(gate * (0.15 + 1.2 * sqrt(dDust)) * falloff, 0.0, 1.0) * uiHome;
  float speck = step(n4 * 0.999, prob);

  float shade = pow(lumD, 0.4) * (0.8 + 0.4 * n3);
  vec3 dustCol = mix(uBg, vec3(shade), clamp(uFade, 0.0, 1.0));

  vec3 unrevealed = mix(mix(baseRgb, uBg, uiHome), dustCol, speck);
  vec3 col = mix(unrevealed, baseRgb, e);
  float alpha = mix(bC.a, dC.a, speck * (1.0 - e));
  outColor = vec4(col, alpha);
}`;

let colorProbe: CanvasRenderingContext2D | null = null;

function parseColor(input: string): [number, number, number] {
  if (typeof document === 'undefined') return [0, 0, 0];
  if (!colorProbe) {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    colorProbe = probe.getContext('2d', { willReadFrequently: true });
  }
  if (!colorProbe) return [0, 0, 0];
  colorProbe.fillStyle = '#000000';
  colorProbe.fillStyle = input;
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillRect(0, 0, 1, 1);
  const data = colorProbe.getImageData(0, 0, 1, 1).data;
  return [data[0] / 255, data[1] / 255, data[2] / 255];
}

// Caches getBoundingClientRect() and refreshes it on resize/scroll instead of
// measuring on every pointermove.
function createRectCache(el: Element) {
  let rect = el.getBoundingClientRect();
  const update = () => {
    rect = el.getBoundingClientRect();
  };
  const ro = new ResizeObserver(update);
  ro.observe(el);
  window.addEventListener('scroll', update, { passive: true, capture: true });
  window.addEventListener('resize', update);
  return {
    get current() {
      return rect;
    },
    destroy() {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    },
  };
}

export function createParticleReveal(
  elements: ParticleRevealElements,
  options: ParticleRevealOptions = {},
): ParticleRevealInstance | null {
  const config = { ...DEFAULTS, ...options };
  const { image, output } = elements;

  const gl = output.getContext('webgl2', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl || gl.isContextLost()) return null;

  function compile(type: number, text: string): WebGLShader {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, text);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error('ParticleReveal shader error:', gl!.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('ParticleReveal program link error:', gl.getProgramInfoLog(program));
    return null;
  }

  const uniforms: Record<string, WebGLUniformLocation> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name] = gl.getUniformLocation(program, info.name)!;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const contentTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  const imgSize: [number, number] = [image.naturalWidth || 1, image.naturalHeight || 1];

  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
  }

  const pointer = { x: -1e5, y: -1e5, tx: -1e5, ty: -1e5, active: 0, target: 0 };
  let time = 0;
  let bgKey = '';
  let bg: [number, number, number] = [0, 0, 0];

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;

  syncCanvasSize();

  function render() {
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    const dpr = output.width / w;
    gl!.useProgram(program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(uniforms.uContent, 0);
    gl!.uniform2f(uniforms.uRes, w, h);
    gl!.uniform2f(uniforms.uImgSize, imgSize[0], imgSize[1]);
    gl!.uniform1f(uniforms.uDpr, dpr);
    gl!.uniform2f(uniforms.uPointer, pointer.x, pointer.y);
    gl!.uniform1f(uniforms.uActive, pointer.active);
    gl!.uniform1f(uniforms.uRadius, Math.max(config.radius, 1));
    gl!.uniform1f(uniforms.uSoftness, config.softness);
    gl!.uniform1f(uniforms.uSize, Math.max(config.size, 0.5));
    gl!.uniform1f(uniforms.uScatter, Math.max(config.scatter, 0));
    gl!.uniform1f(uniforms.uDrift, Math.max(config.drift, 0));
    gl!.uniform1f(uniforms.uAberration, Math.max(config.aberration, 0));
    gl!.uniform1f(uniforms.uBend, Math.max(config.bend, 0));
    gl!.uniform1f(uniforms.uFade, config.fade);
    gl!.uniform1f(uniforms.uThreshold, Math.max(config.threshold, 0));
    if (config.background !== bgKey) {
      bgKey = config.background;
      bg = parseColor(config.background);
    }
    gl!.uniform3f(uniforms.uBg, bg[0], bg[1], bg[2]);
    gl!.uniform1f(uniforms.uTime, time);
    gl!.uniform1f(uniforms.uCrisp, reducedMotion ? 1 : 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, output.width, output.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;

  function frame(now: number) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    time += delta;
    const tau = Math.max(config.smoothing, 1e-4);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta / tau);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    pointer.active += (pointer.target - pointer.active) * k;
    render();
    const settled =
      Math.abs(pointer.tx - pointer.x) < 0.1 &&
      Math.abs(pointer.ty - pointer.y) < 0.1 &&
      Math.abs(pointer.target - pointer.active) < 1e-3;
    if (settled && (reducedMotion || config.drift <= 0)) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
      pointer.active = pointer.target;
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  start();

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    start();
  }
  motionQuery.addEventListener('change', onMotionChange);

  const observer = new ResizeObserver(() => {
    syncCanvasSize();
    start();
  });
  observer.observe(output);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  const rectCache = createRectCache(output);

  // Tracked on window, not the canvas's own element: the canvas sits fixed
  // behind everything (z-index below normal content) so it never intercepts
  // pointer events itself, but we still want the reveal to follow the
  // cursor everywhere on the page, including while hovering the form above
  // it — that's purely cosmetic (background reacting to cursor position)
  // and never touches the form's own interactivity.
  function onPointerMove(event: PointerEvent) {
    const rect = rectCache.current;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (pointer.target === 0 && pointer.active < 1e-3) {
      pointer.x = x;
      pointer.y = y;
    }
    pointer.tx = x;
    pointer.ty = y;
    pointer.target = 1;
    start();
  }

  function onPointerLeave() {
    pointer.target = 0;
    start();
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { passive: true });

  return {
    setOptions(next) {
      if (!Object.entries(next).some(([key, value]) => config[key as keyof ParticleRevealOptions] !== value)) return;
      Object.assign(config, next);
      start();
    },
    destroy() {
      destroyed = true;
      rectCache.destroy();
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      gl!.deleteTexture(contentTexture);
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(quad);
    },
  };
}
