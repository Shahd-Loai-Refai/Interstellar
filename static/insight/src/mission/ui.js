import * as THREE from 'three';

/**
 * World-space UI drawn on canvas textures (HTML is not visible inside a VR headset).
 * Sizes are in metres; text is rendered at 1000 px per metre.
 */
const PX = 1000;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const COLORS = {
  glass: 'rgba(16, 12, 10, 0.82)',
  glassHover: 'rgba(48, 30, 18, 0.9)',
  border: 'rgba(255, 222, 185, 0.35)',
  text: '#ffffff',
  muted: 'rgba(255, 255, 255, 0.55)',
  accent: '#f2a65a',
};

const measureCtx = document.createElement('canvas').getContext('2d');

function wrap(text, fontPx, maxWidthPx, weight = 600) {
  measureCtx.font = `${weight} ${fontPx}px ${FONT}`;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (measureCtx.measureText(test).width > maxWidthPx && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const width = Math.max(...lines.map((l) => measureCtx.measureText(l).width));
  return { lines, width };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A flat panel whose face is drawn by `draw(ctx, w, h, state)`. */
export function createPanel(width, height, draw, { renderOrder = 20 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX);
  canvas.height = Math.round(height * PX);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = renderOrder;

  const panel = {
    mesh,
    width,
    height,
    state: {},
    redraw(state = panel.state) {
      panel.state = state;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, canvas.width, canvas.height, state);
      texture.needsUpdate = true;
    },
    set opacity(v) {
      material.opacity = v;
      mesh.visible = v > 0.001;
    },
    get opacity() {
      return material.opacity;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
  panel.redraw({});
  return panel;
}

/** Dark glass card with wrapped text. Height fits the text. */
export function createCard(text, { width = 1.0, fontSize = 0.06, padding = 0.05, align = 'center', weight = 600, color = COLORS.text } = {}) {
  const fontPx = fontSize * PX;
  const { lines } = wrap(text, fontPx, (width - padding * 2) * PX, weight);
  const lineH = fontPx * 1.25;
  const height = (lines.length * lineH) / PX + padding * 2;
  return createPanel(width, height, (ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = COLORS.glass;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.border;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `${weight} ${fontPx}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const x = align === 'center' ? w / 2 : padding * PX;
    const y0 = h / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * lineH));
  });
}

/** Small floating name tag; width fits the text (wraps above `maxWidth`). */
export function createTag(text, { fontSize = 0.05, maxWidth = 0.85, padding = 0.025 } = {}) {
  const fontPx = fontSize * PX;
  const { lines, width: textW } = wrap(text, fontPx, (maxWidth - padding * 2) * PX);
  const width = textW / PX + padding * 2 + 0.01;
  const lineH = fontPx * 1.2;
  const height = (lines.length * lineH) / PX + padding * 2;
  return createPanel(width, height, (ctx, w, h, state) => {
    roundRect(ctx, 3, 3, w - 6, h - 6, 24);
    ctx.fillStyle = COLORS.glass;
    ctx.fill();
    ctx.lineWidth = state.emphasis ? 6 : 3;
    ctx.strokeStyle = state.emphasis ? COLORS.accent : COLORS.border;
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = `600 ${fontPx}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y0 = h / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * lineH));
  }, { renderOrder: 22 });
}

/**
 * Big button. Variants: 'primary' (accent border, glows when `glow` is set),
 * 'secondary', 'disabled' (dimmed, with a sub-label such as "Coming soon").
 */
export function createButton(label, { width = 0.9, height = 0.16, fontSize = 0.06, variant = 'secondary', sublabel = '' } = {}) {
  const fontPx = fontSize * PX;
  const panel = createPanel(width, height, (ctx, w, h, state) => {
    const disabled = variant === 'disabled';
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fillStyle = state.hover && !disabled ? COLORS.glassHover : COLORS.glass;
    ctx.fill();
    ctx.lineWidth = variant === 'primary' ? 8 : 4;
    ctx.strokeStyle = variant === 'primary' ? COLORS.accent : COLORS.border;
    if (state.hover && !disabled) ctx.strokeStyle = '#ffd2a1';
    ctx.stroke();
    ctx.globalAlpha = disabled ? 0.45 : 1;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontPx}px ${FONT}`;
    const labelLabel = state.label ?? label;
    if (sublabel) {
      ctx.fillText(labelLabel, w / 2, h * 0.4);
      ctx.font = `500 ${fontPx * 0.62}px ${FONT}`;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(sublabel, w / 2, h * 0.74);
    } else {
      ctx.fillText(labelLabel, w / 2, h / 2);
    }
    ctx.globalAlpha = 1;
  }, { renderOrder: 21 });

  panel.setHover = (hover) => {
    if (panel.state.hover !== hover) panel.redraw({ ...panel.state, hover });
  };
  panel.setLabel = (text) => panel.redraw({ ...panel.state, label: text });
  return panel;
}

/** Soft accent glow placed behind a card; pulse it with `opacity`. */
export function createGlow(width, height) {
  const pad = 0.06;
  return createPanel(width + pad * 2, height + pad * 2, (ctx, w, h) => {
    ctx.shadowColor = COLORS.accent;
    ctx.shadowBlur = 45;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 14;
    roundRect(ctx, pad * PX, pad * PX, w - pad * 2 * PX, h - pad * 2 * PX, 40);
    ctx.stroke();
  }, { renderOrder: 19 });
}
