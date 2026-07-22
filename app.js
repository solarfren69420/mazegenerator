import { GIFEncoder, quantize, applyPalette } from "./vendor/gifenc.esm.js";

const N = 1, E = 2, S = 4, W = 8;
const DIRS = [N, E, S, W];
const DX = { [N]: 0, [E]: 1, [S]: 0, [W]: -1 };
const DY = { [N]: -1, [E]: 0, [S]: 1, [W]: 0 };
const OPP = { [N]: S, [E]: W, [S]: N, [W]: E };

const CORNERS = ["Top Left", "Top Right", "Bottom Left", "Bottom Right"];
const STATIC_COLORS = {
  White: "#FFFFFF", Black: "#111116", Slate: "#303640", Graphite: "#1D2028",
  Gray: "#808080", Silver: "#C8CCD2", Red: "#E53935", Crimson: "#B71C1C",
  Orange: "#FB8C00", Amber: "#FFB300", Yellow: "#FDD835", Lime: "#7CB342",
  Green: "#2EAD5B", Emerald: "#008F6B", Teal: "#00897B", Cyan: "#00ACC1",
  "Sky Blue": "#42A5F5", Blue: "#246BCE", Indigo: "#3949AB", Purple: "#8E44AD",
  Magenta: "#D81B60", Pink: "#EC407A", Brown: "#795548", Cream: "#FFF3D6"
};
const SPECIAL_COLORS = ["Rainbow", "Rainbow Reverse", "Animated Rainbow", "Animated Rainbow Reverse", "Custom…"];
const PALETTES = ["Board", "Walls", "Trail", "Solution", "Player", "Start", "Exit"];
const DEFAULT_PALETTES = {
  Board: ["White", "#FFFFFF"], Walls: ["Black", "#111116"], Trail: ["Sky Blue", "#42A5F5"],
  Solution: ["Purple", "#8E44AD"], Player: ["Red", "#E53935"], Start: ["Green", "#2EAD5B"], Exit: ["Orange", "#FB8C00"]
};
const ALGORITHM_NAMES = {
  binary: "Binary Tree (Very Easy)", sidewinder: "Sidewinder (Easy)",
  backtracker: "Recursive Backtracker (Medium)", growing: "Growing Tree (Medium–Hard)",
  prim: "Randomized Prim (Hard)", kruskal: "Randomized Kruskal (Hard)",
  wilson: "Wilson (Very Hard)", aldous: "Aldous–Broder (Very Hard)"
};

const $ = (id) => document.getElementById(id);
const els = {
  algorithm: $("algorithm"), width: $("mazeWidth"), height: $("mazeHeight"), seed: $("seed"),
  complexity: $("complexity"), braid: $("braid"), complexityOut: $("complexityOut"), braidOut: $("braidOut"),
  start: $("startCorner"), exit: $("exitCorner"), cellSize: $("cellSize"), wallWidth: $("wallWidth"),
  playerMode: $("playerMode"), showTrail: $("showTrail"), showSolution: $("showSolution"),
  format: $("format"), gifFrames: $("gifFrames"), gifSpeed: $("gifSpeed"), gifOptions: $("gifOptions"),
  download: $("download"), canvas: $("mazeCanvas"), stage: $("canvasStage"), status: $("status"),
  completion: $("completion"), completionText: $("completionText"), solutionQuick: $("solutionQuick"), toast: $("toast")
};

const state = {
  maze: null,
  player: 0,
  trail: [],
  moves: 0,
  complete: false,
  phase: 0,
  palettes: {},
  solution: [],
  previewCell: 16,
  renderPending: false,
  exporting: false
};

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function hashSeed(text) {
  const value = String(text).trim();
  if (/^-?\d+$/.test(value)) return Number(BigInt(value) & 0xffffffffn) >>> 0;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class RNG {
  constructor(seed) { this.state = seed >>> 0; }
  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  int(max) { return Math.floor(this.next() * max); }
  pick(array) { return array[this.int(array.length)]; }
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

class Maze {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.seed = seed;
    this.grid = new Uint8Array(this.size);
    this.rng = new RNG(seed);
  }
  id(x, y) { return y * this.width + x; }
  x(id) { return id % this.width; }
  y(id) { return Math.floor(id / this.width); }
  neighbor(id, dir) {
    const x = this.x(id) + DX[dir], y = this.y(id) + DY[dir];
    return x >= 0 && y >= 0 && x < this.width && y < this.height ? this.id(x, y) : -1;
  }
  neighbors(id) {
    const out = [];
    for (const dir of DIRS) {
      const next = this.neighbor(id, dir);
      if (next >= 0) out.push([dir, next]);
    }
    return out;
  }
  connected(id) {
    const out = [], passages = this.grid[id];
    for (const dir of DIRS) if (passages & dir) out.push(this.neighbor(id, dir));
    return out;
  }
  carve(a, b, dir = 0) {
    if (!dir) {
      const delta = b - a;
      dir = delta === -this.width ? N : delta === 1 ? E : delta === this.width ? S : W;
    }
    this.grid[a] |= dir;
    this.grid[b] |= OPP[dir];
  }
  binaryTree() {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const id = this.id(x, y), options = [];
      if (y > 0) options.push([N, id - this.width]);
      if (x < this.width - 1) options.push([E, id + 1]);
      if (options.length) { const [dir, next] = this.rng.pick(options); this.carve(id, next, dir); }
    }
  }
  sidewinder() {
    for (let y = 0; y < this.height; y++) {
      let run = [];
      for (let x = 0; x < this.width; x++) {
        const id = this.id(x, y); run.push(id);
        const close = x === this.width - 1 || (y > 0 && this.rng.next() < .5);
        if (close) {
          if (y > 0) { const member = this.rng.pick(run); this.carve(member, member - this.width, N); }
          run = [];
        } else this.carve(id, id + 1, E);
      }
    }
  }
  backtracker() {
    const start = this.rng.int(this.size), visited = new Uint8Array(this.size), stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const current = stack[stack.length - 1];
      const candidates = this.neighbors(current).filter(([, n]) => !visited[n]);
      if (!candidates.length) { stack.pop(); continue; }
      const [dir, next] = this.rng.pick(candidates);
      this.carve(current, next, dir); visited[next] = 1; stack.push(next);
    }
  }
  growingTree(newestBias) {
    const start = this.rng.int(this.size), visited = new Uint8Array(this.size), active = [start];
    visited[start] = 1;
    while (active.length) {
      const index = this.rng.next() < newestBias ? active.length - 1 : this.rng.int(active.length);
      const current = active[index], candidates = this.neighbors(current).filter(([, n]) => !visited[n]);
      if (candidates.length) {
        const [dir, next] = this.rng.pick(candidates);
        this.carve(current, next, dir); visited[next] = 1; active.push(next);
      } else active.splice(index, 1);
    }
  }
  prim() {
    const start = this.rng.int(this.size), visited = new Uint8Array(this.size), frontier = [];
    const add = (id) => { for (const [dir, next] of this.neighbors(id)) if (!visited[next]) frontier.push([id, dir, next]); };
    visited[start] = 1; add(start);
    while (frontier.length) {
      const index = this.rng.int(frontier.length), edge = frontier[index];
      frontier[index] = frontier[frontier.length - 1]; frontier.pop();
      const [from, dir, next] = edge;
      if (visited[next]) continue;
      this.carve(from, next, dir); visited[next] = 1; add(next);
    }
  }
  kruskal() {
    const parent = new Int32Array(this.size), rank = new Uint8Array(this.size), edges = [];
    for (let i = 0; i < this.size; i++) parent[i] = i;
    const find = (item) => { let root = item; while (parent[root] !== root) root = parent[root]; while (parent[item] !== item) { const p = parent[item]; parent[item] = root; item = p; } return root; };
    const union = (a, b) => { let ra = find(a), rb = find(b); if (ra === rb) return false; if (rank[ra] < rank[rb]) [ra, rb] = [rb, ra]; parent[rb] = ra; if (rank[ra] === rank[rb]) rank[ra]++; return true; };
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const id = this.id(x, y);
      if (x + 1 < this.width) edges.push([id, E, id + 1]);
      if (y + 1 < this.height) edges.push([id, S, id + this.width]);
    }
    this.rng.shuffle(edges);
    for (const [a, dir, b] of edges) if (union(a, b)) this.carve(a, b, dir);
  }
  wilson() {
    const unvisited = Array.from({ length: this.size }, (_, i) => i);
    const positions = new Int32Array(this.size); for (let i = 0; i < this.size; i++) positions[i] = i;
    const inTree = new Uint8Array(this.size);
    const remove = (id) => {
      const at = positions[id]; if (at < 0) return;
      const last = unvisited.pop();
      if (at < unvisited.length) { unvisited[at] = last; positions[last] = at; }
      positions[id] = -1;
    };
    const first = this.rng.pick(unvisited); inTree[first] = 1; remove(first);
    while (unvisited.length) {
      const start = this.rng.pick(unvisited), path = [start], pathPos = new Map([[start, 0]]);
      let current = start;
      while (!inTree[current]) {
        const [, next] = this.rng.pick(this.neighbors(current));
        if (pathPos.has(next)) {
          const keep = pathPos.get(next);
          for (let i = path.length - 1; i > keep; i--) pathPos.delete(path[i]);
          path.length = keep + 1;
        } else { pathPos.set(next, path.length); path.push(next); }
        current = next;
      }
      for (let i = 0; i < path.length - 1; i++) { this.carve(path[i], path[i + 1]); inTree[path[i]] = 1; remove(path[i]); }
      inTree[path[path.length - 1]] = 1; remove(path[path.length - 1]);
    }
  }
  aldousBroder() {
    let current = this.rng.int(this.size), count = 1;
    const visited = new Uint8Array(this.size); visited[current] = 1;
    while (count < this.size) {
      const [dir, next] = this.rng.pick(this.neighbors(current));
      if (!visited[next]) { this.carve(current, next, dir); visited[next] = 1; count++; }
      current = next;
    }
  }
  braid(amount) {
    if (amount <= 0) return;
    const deadEnds = [];
    for (let id = 0; id < this.size; id++) if (this.connected(id).length === 1) deadEnds.push(id);
    this.rng.shuffle(deadEnds);
    for (const id of deadEnds) {
      if (this.rng.next() > amount) continue;
      const closed = this.neighbors(id).filter(([dir]) => !(this.grid[id] & dir));
      if (!closed.length) continue;
      const preferred = closed.filter(([, next]) => this.connected(next).length === 1);
      const [dir, next] = this.rng.pick(preferred.length ? preferred : closed);
      this.carve(id, next, dir);
    }
  }
  solve(start, end) {
    const came = new Int32Array(this.size); came.fill(-2); came[start] = -1;
    const queue = new Int32Array(this.size); let head = 0, tail = 0; queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++]; if (current === end) break;
      for (const next of this.connected(current)) if (came[next] === -2) { came[next] = current; queue[tail++] = next; }
    }
    if (came[end] === -2) return [];
    const path = []; for (let current = end; current !== -1; current = came[current]) path.push(current);
    return path.reverse();
  }
}

function setupControls() {
  for (const corner of CORNERS) {
    els.start.add(new Option(corner, corner));
    els.exit.add(new Option(corner, corner));
  }
  els.start.value = "Top Left"; els.exit.value = "Bottom Right";
  const container = $("paletteControls");
  for (const name of PALETTES) {
    const [mode, custom] = DEFAULT_PALETTES[name]; state.palettes[name] = { mode, custom };
    const row = document.createElement("label"); row.className = "palette-row";
    const label = document.createElement("span"); label.textContent = name;
    const select = document.createElement("select"); select.dataset.palette = name; select.setAttribute("aria-label", `${name} palette`);
    for (const option of [...Object.keys(STATIC_COLORS), ...SPECIAL_COLORS]) select.add(new Option(option, option));
    select.value = mode;
    const color = document.createElement("input"); color.type = "color"; color.value = custom; color.dataset.custom = name; color.title = `Custom ${name.toLowerCase()} color`;
    color.hidden = mode !== "Custom…";
    row.append(label, select, color); container.append(row);
    select.addEventListener("change", () => { state.palettes[name].mode = select.value; color.hidden = select.value !== "Custom…"; scheduleRender(); });
    color.addEventListener("input", () => { state.palettes[name].custom = color.value; if (select.value === "Custom…") scheduleRender(); });
  }
}

function cornerId(name) {
  const m = state.maze;
  return { "Top Left": 0, "Top Right": m.width - 1, "Bottom Left": (m.height - 1) * m.width, "Bottom Right": m.size - 1 }[name];
}

function generate() {
  try {
    const width = clamp(Math.round(els.width.value), 2, 300), height = clamp(Math.round(els.height.value), 2, 300);
    els.width.value = width; els.height.value = height;
    if (els.start.value === els.exit.value) throw new Error("Start and exit must be different corners.");
    if (!els.seed.value.trim()) els.seed.value = randomSeed();
    const seed = hashSeed(els.seed.value), maze = new Maze(width, height, seed);
    const complexity = clamp(els.complexity.value, 0, 1);
    const generators = {
      binary: () => maze.binaryTree(), sidewinder: () => maze.sidewinder(), backtracker: () => maze.backtracker(),
      growing: () => maze.growingTree(.15 + .85 * complexity), prim: () => maze.prim(), kruskal: () => maze.kruskal(),
      wilson: () => maze.wilson(), aldous: () => maze.aldousBroder()
    };
    generators[els.algorithm.value](); maze.braid(clamp(els.braid.value, 0, 1));
    state.maze = maze; resetPlayer(false); updateSolution(); scheduleRender(); updateStatus();
    els.stage.focus();
  } catch (error) { toast(error.message, true); }
}

function randomSeed() {
  const values = new Uint32Array(1); crypto.getRandomValues(values); return String(values[0] & 0x7fffffff);
}
function randomizeAndGenerate() { els.seed.value = randomSeed(); generate(); }

function updateSolution() {
  if (!state.maze) return;
  state.solution = state.maze.solve(cornerId(els.start.value), cornerId(els.exit.value));
}

function resetPlayer(redraw = true) {
  if (!state.maze) return;
  state.player = cornerId(els.start.value); state.trail = [state.player]; state.moves = 0; state.complete = false;
  els.completion.hidden = true;
  if (redraw) { scheduleRender(); updateStatus(); els.stage.focus(); }
}

function move(dir) {
  if (!els.playerMode.checked || !state.maze || state.complete) return;
  if (!(state.maze.grid[state.player] & dir)) { toast("Wall! Try another direction."); return; }
  state.player = state.maze.neighbor(state.player, dir); state.trail.push(state.player); state.moves++;
  if (state.player === cornerId(els.exit.value)) {
    state.complete = true; els.completionText.textContent = `You reached the exit in ${state.moves} moves.`; els.completion.hidden = false;
  }
  scheduleRender(); updateStatus();
}

function keyHandler(event) {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const dir = { ArrowUp: N, w: N, W: N, ArrowRight: E, d: E, D: E, ArrowDown: S, s: S, S, ArrowLeft: W, a: W, A: W }[event.key];
  if (dir) { event.preventDefault(); move(dir); }
}

function hsvToHex(h, s = .92, v = 1) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  return `#${[r,g,b].map(x => Math.round(x * 255).toString(16).padStart(2,"0")).join("")}`;
}
function isRainbow(mode) { return mode.includes("Rainbow"); }
function isAnimated(mode) { return mode.startsWith("Animated"); }
function anyAnimated() { return Object.values(state.palettes).some(({ mode }) => isAnimated(mode)); }
function paletteColor(name, position, phase) {
  const { mode, custom } = state.palettes[name];
  if (STATIC_COLORS[mode]) return STATIC_COLORS[mode];
  if (mode === "Custom…") return custom;
  const reverse = mode.includes("Reverse");
  const motion = isAnimated(mode) ? phase : 0;
  return hsvToHex(motion + (reverse ? -position : position));
}

function rainbowGradient(ctx, name, x0, y0, x1, y1, phase) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i <= 12; i++) gradient.addColorStop(i / 12, paletteColor(name, i / 12, phase));
  return gradient;
}

function drawPath(ctx, points, name, phase, width, cell, margin) {
  if (points.length < 2) return;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = width;
  const center = (id) => [margin + state.maze.x(id) * cell + cell / 2, margin + state.maze.y(id) * cell + cell / 2];
  if (isRainbow(state.palettes[name].mode)) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = center(points[i]), b = center(points[i + 1]); ctx.strokeStyle = paletteColor(name, i / Math.max(1, points.length - 2), phase);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = paletteColor(name, .5, phase); ctx.beginPath();
    points.forEach((id, i) => { const p = center(id); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }); ctx.stroke();
  }
}

function renderTo(canvas, phase, options = {}) {
  const maze = state.maze; if (!maze) return;
  const cell = options.cell ?? clamp(els.cellSize.value, 4, 100);
  const wall = options.wall ?? clamp(els.wallWidth.value, 1, 20);
  const margin = Math.max(8, Math.round(cell * .67));
  const width = Math.ceil(maze.width * cell + margin * 2 + wall), height = Math.ceil(maze.height * cell + margin * 2 + wall);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const boardMode = state.palettes.Board.mode;
  ctx.fillStyle = isRainbow(boardMode) ? rainbowGradient(ctx, "Board", 0, 0, width, height, phase) : paletteColor("Board", 0, phase);
  ctx.fillRect(0, 0, width, height);
  const x0 = margin, y0 = margin, x1 = x0 + maze.width * cell, y1 = y0 + maze.height * cell;
  ctx.lineWidth = wall; ctx.lineCap = "butt";
  const wallStroke = (position) => paletteColor("Walls", position, phase);
  for (let x = 0; x < maze.width; x++) {
    const p = x / Math.max(1, maze.width - 1), left = x0 + x * cell, right = left + cell;
    ctx.strokeStyle = wallStroke(p); ctx.beginPath(); ctx.moveTo(left, y0); ctx.lineTo(right, y0); ctx.moveTo(left, y1); ctx.lineTo(right, y1); ctx.stroke();
  }
  for (let y = 0; y < maze.height; y++) {
    const p = y / Math.max(1, maze.height - 1), top = y0 + y * cell, bottom = top + cell;
    ctx.strokeStyle = wallStroke(p); ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x0, bottom); ctx.moveTo(x1, top); ctx.lineTo(x1, bottom); ctx.stroke();
  }
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const id = maze.id(x, y), passages = maze.grid[id], left = x0 + x * cell, top = y0 + y * cell, right = left + cell, bottom = top + cell;
    ctx.strokeStyle = wallStroke((x / Math.max(1, maze.width - 1) + y / Math.max(1, maze.height - 1)) / 2);
    ctx.beginPath();
    if (x < maze.width - 1 && !(passages & E)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom); }
    if (y < maze.height - 1 && !(passages & S)) { ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); }
    ctx.stroke();
  }
  if (els.showSolution.checked) drawPath(ctx, state.solution, "Solution", phase, Math.max(2, cell / 5), cell, margin);
  if (els.playerMode.checked && els.showTrail.checked) drawPath(ctx, state.trail, "Trail", phase, Math.max(2, cell / 4), cell, margin);
  const center = (id) => [x0 + maze.x(id) * cell + cell / 2, y0 + maze.y(id) * cell + cell / 2];
  const markerRadius = Math.max(3, cell / 4);
  for (const [name, id] of [["Start", cornerId(els.start.value)], ["Exit", cornerId(els.exit.value)]]) {
    const [cx, cy] = center(id); ctx.fillStyle = paletteColor(name, .5, phase); ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(1, wall / 2);
    ctx.beginPath(); ctx.arc(cx, cy, markerRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (els.playerMode.checked) {
    const [cx, cy] = center(state.player), radius = Math.max(4, cell * .31), pos = (maze.x(state.player) + maze.y(state.player)) / Math.max(1, maze.width + maze.height - 2);
    ctx.fillStyle = paletteColor("Player", pos, phase); ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, wall);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(cx - radius * .35, cy - radius * .35, Math.max(1.5, radius / 5), 0, Math.PI * 2); ctx.fill();
  }
}

function previewCellSize() {
  if (!state.maze) return 16;
  const rect = els.stage.getBoundingClientRect(), margin = 22;
  return Math.max(2, Math.min(clamp(els.cellSize.value, 4, 100), (rect.width - margin * 2) / state.maze.width, (rect.height - margin * 2) / state.maze.height));
}
function renderPreview() { state.renderPending = false; if (!state.maze) return; state.previewCell = previewCellSize(); renderTo(els.canvas, state.phase, { cell: state.previewCell, wall: Math.max(1, clamp(els.wallWidth.value, 1, 20) * state.previewCell / clamp(els.cellSize.value, 4, 100)) }); }
function scheduleRender() { if (!state.renderPending) { state.renderPending = true; requestAnimationFrame(renderPreview); } }

function updateStatus() {
  if (!state.maze) return;
  const shortest = Math.max(0, state.solution.length - 1), player = els.playerMode.checked ? ` · ${state.moves} player moves${state.complete ? " · COMPLETE" : ""}` : "";
  els.status.innerHTML = `<strong>${ALGORITHM_NAMES[els.algorithm.value]}</strong> · ${state.maze.width}×${state.maze.height} · seed ${escapeHtml(els.seed.value)} · shortest ${shortest}${player}`;
}
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

function validateExportSize(cell) {
  const m = state.maze, margin = Math.max(8, Math.round(cell * .67)), w = Math.ceil(m.width * cell + margin * 2 + clamp(els.wallWidth.value, 1, 20)), h = Math.ceil(m.height * cell + margin * 2 + clamp(els.wallWidth.value, 1, 20));
  if (w > 16384 || h > 16384 || w * h > 70000000) throw new Error(`Export would be ${w.toLocaleString()}×${h.toLocaleString()} px. Lower the cell size or maze dimensions.`);
  return [w, h];
}

function filename(ext) {
  const slug = els.algorithm.options[els.algorithm.selectedIndex].text.split(" (")[0].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `maze_${slug}_${state.maze.width}x${state.maze.height}_seed_${String(els.seed.value).replace(/[^a-z0-9_-]+/gi,"_")}.${ext}`;
}
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
function canvasBlob(canvas, type, quality) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The browser could not encode this image.")), type, quality)); }

function bmpBlob(canvas) {
  const ctx = canvas.getContext("2d"), { width, height } = canvas, rgba = ctx.getImageData(0, 0, width, height).data;
  const row = Math.ceil(width * 3 / 4) * 4, pixelBytes = row * height, buffer = new ArrayBuffer(54 + pixelBytes), view = new DataView(buffer), bytes = new Uint8Array(buffer);
  const write = (offset, value, size) => size === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true);
  bytes[0] = 0x42; bytes[1] = 0x4d; write(2, buffer.byteLength, 4); write(10, 54, 4); write(14, 40, 4); write(18, width, 4); write(22, height, 4); write(26, 1, 2); write(28, 24, 2); write(34, pixelBytes, 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = ((height - 1 - y) * width + x) * 4, target = 54 + y * row + x * 3;
    bytes[target] = rgba[source + 2]; bytes[target + 1] = rgba[source + 1]; bytes[target + 2] = rgba[source];
  }
  return new Blob([buffer], { type: "image/bmp" });
}

async function exportImage() {
  if (!state.maze || state.exporting) return;
  const format = els.format.value, cell = clamp(els.cellSize.value, 4, 100);
  try {
    validateExportSize(cell); state.exporting = true; els.download.disabled = true; els.download.textContent = "Rendering…";
    const canvas = document.createElement("canvas");
    if (format === "gif") {
      const animated = anyAnimated(), frameCount = animated ? clamp(Math.round(els.gifFrames.value), 8, 180) : 1, delay = clamp(Math.round(els.gifSpeed.value), 20, 500);
      const encoder = GIFEncoder();
      for (let i = 0; i < frameCount; i++) {
        els.download.textContent = `Encoding GIF ${i + 1}/${frameCount}`; await new Promise(requestAnimationFrame);
        renderTo(canvas, animated ? i / frameCount : state.phase, { cell });
        const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const palette = quantize(rgba, 256), index = applyPalette(rgba, palette);
        encoder.writeFrame(index, canvas.width, canvas.height, { palette, delay, repeat: 0 });
      }
      encoder.finish(); downloadBlob(new Blob([encoder.bytes()], { type: "image/gif" }), filename("gif"));
    } else {
      renderTo(canvas, state.phase, { cell });
      const blob = format === "bmp" ? bmpBlob(canvas) : await canvasBlob(canvas, format === "jpeg" ? "image/jpeg" : "image/png", .95);
      downloadBlob(blob, filename(format === "jpeg" ? "jpg" : format));
    }
    toast(`${format.toUpperCase()} downloaded.`);
  } catch (error) { toast(error.message, true); }
  finally { state.exporting = false; els.download.disabled = false; updateFormatUI(); }
}

let toastTimer;
function toast(message, danger = false) {
  clearTimeout(toastTimer); els.toast.textContent = message; els.toast.style.borderColor = danger ? "#a84b5c" : ""; els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function updateFormatUI() {
  const fmt = els.format.value; els.gifOptions.classList.toggle("is-hidden", fmt !== "gif");
  els.download.textContent = `Download ${fmt === "jpeg" ? "JPEG" : fmt.toUpperCase()}`;
}

function bindEvents() {
  $("generateTop").addEventListener("click", generate); $("randomSeed").addEventListener("click", randomizeAndGenerate); $("seedDice").addEventListener("click", randomizeAndGenerate);
  $("resetPlayer").addEventListener("click", () => resetPlayer()); $("playAgain").addEventListener("click", () => resetPlayer());
  els.playerMode.addEventListener("change", () => { resetPlayer(false); scheduleRender(); updateStatus(); els.stage.focus(); });
  els.showTrail.addEventListener("change", scheduleRender); els.showSolution.addEventListener("change", () => { els.solutionQuick.setAttribute("aria-pressed", String(els.showSolution.checked)); els.solutionQuick.textContent = els.showSolution.checked ? "Hide solution" : "Show solution"; scheduleRender(); });
  els.solutionQuick.addEventListener("click", () => { els.showSolution.checked = !els.showSolution.checked; els.showSolution.dispatchEvent(new Event("change")); });
  for (const select of [els.start, els.exit]) select.addEventListener("change", () => {
    if (els.start.value === els.exit.value) { toast("Start and exit must be different corners.", true); return; }
    updateSolution(); resetPlayer(false); scheduleRender(); updateStatus();
  });
  for (const input of [els.cellSize, els.wallWidth]) input.addEventListener("input", scheduleRender);
  for (const [input, output] of [[els.complexity, els.complexityOut], [els.braid, els.braidOut]]) input.addEventListener("input", () => output.textContent = `${Math.round(input.value * 100)}%`);
  els.format.addEventListener("change", updateFormatUI); els.download.addEventListener("click", exportImage);
  window.addEventListener("keydown", keyHandler); window.addEventListener("resize", scheduleRender);
  new ResizeObserver(scheduleRender).observe(els.stage);
  document.querySelectorAll(".dpad button").forEach(button => button.addEventListener("click", () => { move({ N, E, S, W }[button.dataset.dir]); els.stage.focus(); }));
}

let lastAnimatedRender = 0;
function animationLoop(time) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (anyAnimated() && !reduced && time - lastAnimatedRender >= 48) {
    lastAnimatedRender = time; state.phase = (time / 4200) % 1; scheduleRender();
  }
  requestAnimationFrame(animationLoop);
}

setupControls(); bindEvents(); updateFormatUI(); generate(); requestAnimationFrame(animationLoop);
