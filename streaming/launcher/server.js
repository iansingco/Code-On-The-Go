const express = require("express");
const { execSync, spawn } = require("child_process");
const { createHmac, timingSafeEqual } = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const app = express();
const server = http.createServer(app);

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG_PATH = path.join(__dirname, "apps.config.json");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const KASM_PASSWORD = process.env.KASM_PASSWORD || "password";
const GIT_DIR = process.env.GIT_DIR || "/repo";
// Absolute path to the streaming/ dir ON THE HOST (needed for volume mounts
// when the launcher spawns sibling containers via the Docker socket).
const HOST_REPO_PATH = process.env.HOST_REPO_PATH || "";

const deployLog = [];
function logEvent(e) {
  deployLog.unshift({ ...e, ts: new Date().toISOString() });
  if (deployLog.length > 20) deployLog.pop();
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadApps() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch (e) { console.error("Failed to load apps.config.json:", e.message); return []; }
}

// ── Docker helpers ────────────────────────────────────────────────────────────

function containerName(id) { return `streaming-${id}`; }

// Returns true if the custom image has been built at least once.
function imageExists(id) {
  try {
    execSync(`docker image inspect ${customImageTag(id)} 2>/dev/null`);
    return true;
  } catch { return false; }
}

function containerStatus(id) {
  try {
    const out = execSync(
      `docker inspect --format='{{.State.Running}}' ${containerName(id)} 2>/dev/null`
    ).toString().trim();
    return out === "true" ? "running" : "stopped";
  } catch { return "stopped"; }
}

function containerStartedAt(id) {
  try {
    return execSync(
      `docker inspect --format='{{.State.StartedAt}}' ${containerName(id)} 2>/dev/null`
    ).toString().trim() || null;
  } catch { return null; }
}

// Resolve a workspace path: app.workspace is relative to the streaming/ dir.
// Returns the HOST path (passed to docker run -v) if HOST_REPO_PATH is set,
// otherwise falls back to the in-container /repo path (works for Linux hosts).
function resolveWorkspacePath(workspace) {
  if (!workspace) return null;
  if (HOST_REPO_PATH) return path.join(HOST_REPO_PATH, workspace).replace(/\\/g, "/");
  return path.join(GIT_DIR, workspace);
}

// Resolve Dockerfile build context path.
// Always uses the container-internal /repo path — docker build sends the context
// from the launcher container (which has the repo mounted at GIT_DIR) to the
// Docker daemon. HOST_REPO_PATH is only needed for -v flags in docker run.
function resolveDockerfilePath(dockerfile) {
  if (!dockerfile) return null;
  return path.join(GIT_DIR, dockerfile);
}

// Build the image tag for a custom-dockerfile app.
function customImageTag(id) { return `streaming-${id}:local`; }

// Determine which image to use: custom build or pre-built pull.
function resolvedImage(app) {
  return app.dockerfile ? customImageTag(app.id) : app.image;
}

// Build and run a container from an app config entry.
// If the container already exists (stopped), just start it.
function containerStart(app) {
  const name = containerName(app.id);
  // Check if container exists (running or stopped)
  try {
    execSync(`docker inspect ${name} 2>/dev/null`);
    // Exists — just start it
    execSync(`docker start ${name}`);
    return;
  } catch {}

  // Doesn't exist — docker run it
  const args = [
    "docker run -d",
    `--name ${name}`,
    "--restart unless-stopped",
    "--shm-size=512mb",
    `-p ${app.port}:6901`,
    `-e VNC_PW=${KASM_PASSWORD}`,
  ];

  // Pass-through env vars defined in app config
  for (const key of (app.env || [])) {
    const val = process.env[key];
    if (val) args.push(`-e ${key}=${val}`);
  }

  // Workspace volume mount
  const wsPath = resolveWorkspacePath(app.workspace);
  if (wsPath) args.push(`-v "${wsPath}:/home/kasm-user/workspace"`);

  args.push(resolvedImage(app));
  execSync(args.join(" "));
}

// Rebuild a custom dockerfile app image, then restart its container.
// onProgress receives each line of docker build output in real time.
async function containerRebuild(app, onProgress) {
  if (!app.dockerfile) throw new Error("App has no dockerfile — nothing to rebuild");
  const tag = customImageTag(app.id);
  const ctx = resolveDockerfilePath(app.dockerfile);
  onProgress(`Building ${tag} from ${ctx}...`);

  await new Promise((resolve, reject) => {
    const proc = spawn("docker", ["build", "-t", tag, ctx]);
    const pipe = (data) =>
      data.toString().split("\n").filter(l => l.trim()).forEach(l => onProgress(l));
    proc.stdout.on("data", pipe);
    proc.stderr.on("data", pipe);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`docker build failed (exit ${code})`)));
    proc.on("error", reject);
  });

  onProgress("Build complete — restarting container...");
  try { execSync(`docker stop ${containerName(app.id)} 2>/dev/null`); } catch {}
  try { execSync(`docker rm   ${containerName(app.id)} 2>/dev/null`); } catch {}
  containerStart(app);
  onProgress("Done.");
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function gitChangedFiles() {
  try {
    return execSync(`git -C ${GIT_DIR} diff --name-only HEAD@{1} HEAD 2>/dev/null`)
      .toString().trim().split("\n").filter(Boolean);
  } catch { return []; }
}

// Detect the tech stack of a cloned repo by inspecting key files.
function detectStack(repoPath) {
  const checks = [
    { file: "package.json",    stack: "Node.js" },
    { file: "project.godot",   stack: "Godot" },
    { file: "requirements.txt",stack: "Python" },
    { file: "Cargo.toml",      stack: "Rust" },
    { file: "go.mod",          stack: "Go" },
    { file: "pom.xml",         stack: "Java/Maven" },
    { file: "build.gradle",    stack: "Java/Gradle" },
  ];
  for (const { file, stack } of checks) {
    if (fs.existsSync(path.join(repoPath, file))) return stack;
  }
  return "Unknown";
}

// Pick a pre-built kasmweb image for a stack — no rebuild needed to get started.
const KASM_TAG = "1.18.0-rolling-daily";
function defaultImageForStack(stack) {
  // VS Code works for everything as a starting point
  return `kasmweb/vs-code:${KASM_TAG}`;
}

const STACK_ICONS = { "Node.js":"⬡", "Godot":"🎮", "Python":"🐍", "Rust":"🦀", "Go":"🐹", "Java/Maven":"☕", "Java/Gradle":"☕" };
function stackIcon(stack) { return STACK_ICONS[stack] || "📦"; }

// Find the next port not already used in apps.config.json.
function findNextPort() {
  const used = new Set(loadApps().map(a => a.port));
  let p = 6901;
  while (used.has(p)) p++;
  return p;
}

// Read key names from a .env.example file in a repo (values stripped).
function readEnvExample(repoPath) {
  const f = path.join(repoPath, ".env.example");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=")[0].trim())
    .filter(Boolean);
}

// Parse the host .env file into a key→value map.
function readHostEnv() {
  const f = path.join(GIT_DIR, ".env");
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(
    fs.readFileSync(f, "utf8").split("\n")
      .map(l => l.trim()).filter(l => l && !l.startsWith("#"))
      .map(l => { const i = l.indexOf("="); return [l.slice(0,i), l.slice(i+1)]; })
      .filter(([k]) => k)
  );
}

// Write/update keys in the host .env file.
function writeHostEnv(updates) {
  const f = path.join(GIT_DIR, ".env");
  const existing = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const lines = existing.split("\n");
  for (const [key, val] of Object.entries(updates)) {
    const idx = lines.findIndex(l => l.startsWith(key + "=") || l.startsWith(key + " ="));
    const line = `${key}=${val}`;
    if (idx >= 0) lines[idx] = line; else lines.push(line);
  }
  fs.writeFileSync(f, lines.join("\n").trimEnd() + "\n");
}

// Write apps.config.json back to disk (via /repo which is the writable mount).
function saveApps(apps) {
  fs.writeFileSync(path.join(GIT_DIR, "apps.config.json"), JSON.stringify(apps, null, 2) + "\n");
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get("/api/apps", (req, res) => {
  res.json(loadApps().map(a => ({
    ...a,
    status: containerStatus(a.id),
    startedAt: containerStartedAt(a.id),
    rebuildable: !!a.dockerfile,
    imageReady: a.dockerfile ? imageExists(a.id) : true,
  })));
});

app.post("/api/apps/:id/start", (req, res) => {
  const app = loadApps().find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Unknown app" });
  try { containerStart(app); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apps/:id/stop", (req, res) => {
  const app = loadApps().find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Unknown app" });
  try { execSync(`docker stop ${containerName(req.params.id)}`); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Rebuild triggers a docker build + container restart (async, streams log via SSE).
app.get("/api/apps/:id/rebuild", async (req, res) => {
  const app = loadApps().find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Unknown app" });
  if (!app.dockerfile) return res.status(400).json({ error: "No dockerfile configured" });

  // Server-Sent Events so the UI can stream build progress
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (msg) => {
    res.write(`data: ${JSON.stringify({ msg })}\n\n`);
    console.log(`[rebuild:${app.id}]`, msg);
  };

  try {
    await containerRebuild(app, send);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }
  res.end();
});

app.get("/api/deploy/log", (req, res) => res.json(deployLog));

// Clone a repo and auto-register it in apps.config.json.
// No rebuild needed — uses a pre-built kasmweb image by default.
app.post("/api/clone", (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });

  const name = path.basename(url, ".git").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const id   = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const dest = path.join(GIT_DIR, "repos", name);

  if (fs.existsSync(dest)) return res.status(409).json({ error: `Already exists at repos/${name}` });

  try {
    fs.mkdirSync(path.join(GIT_DIR, "repos"), { recursive: true });
    execSync(`git clone "${url}" "${dest}"`, { timeout: 120000 });

    const stack   = detectStack(dest);
    const envKeys = readEnvExample(dest);  // keys from .env.example if present

    // Auto-register in apps.config.json if not already there
    const apps = loadApps();
    if (!apps.find(a => a.id === id)) {
      apps.push({
        id,
        label: name,
        port: findNextPort(),
        icon: stackIcon(stack),
        description: `${stack} — VS Code workspace`,
        image: defaultImageForStack(stack),
        workspace: `repos/${name}`,
        env: envKeys,          // pass these from .env into the container
        autorestart: false,
        rebuildTriggers: [],
      });
      saveApps(apps);
    }

    res.json({ ok: true, id, name, path: `repos/${name}`, stack, envKeys });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Return env vars needed by an app and their current values in .env.
app.get("/api/apps/:id/envvars", (req, res) => {
  const app = loadApps().find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Unknown app" });
  const current = readHostEnv();
  const vars = (app.env || []).map(k => ({ key: k, value: current[k] || "" }));
  res.json(vars);
});

// Write env var values into the host .env file.
app.post("/api/apps/:id/envvars", (req, res) => {
  const app = loadApps().find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Unknown app" });
  const updates = req.body; // { KEY: "value", ... }
  if (typeof updates !== "object") return res.status(400).json({ error: "expected object" });
  try {
    writeHostEnv(updates);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CI/CD Webhook ─────────────────────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  if (WEBHOOK_SECRET) {
    const sig = req.headers["x-hub-signature-256"];
    if (!sig) return res.status(401).json({ error: "Missing signature" });
    const expected = "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(req.body).digest("hex");
    try {
      const a = Buffer.from(sig), b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b))
        return res.status(401).json({ error: "Invalid signature" });
    } catch { return res.status(401).json({ error: "Signature error" }); }
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: "Bad JSON" }); }

  const branch = (payload.ref || "").replace("refs/heads/", "");
  const repo = payload.repository?.full_name || "unknown";
  const pusher = payload.pusher?.name || "unknown";
  const commitMsg = payload.head_commit?.message?.split("\n")[0] || "";

  console.log(`[webhook] ${repo}@${branch} by ${pusher}: ${commitMsg}`);

  // Pull latest
  let pullOutput = "";
  try { pullOutput = execSync(`git -C ${GIT_DIR} pull`, { timeout: 30000 }).toString().trim(); }
  catch (e) { pullOutput = `FAILED: ${e.message}`; }

  // Check which files changed — used to trigger selective rebuilds
  const changedFiles = gitChangedFiles();
  const apps = loadApps();

  const restarted = [];
  const rebuilt = [];

  for (const app of apps) {
    // Check if any rebuildTrigger file changed
    const needsRebuild = app.dockerfile && (app.rebuildTriggers || [])
      .some(trigger => changedFiles.some(f => f.endsWith(trigger)));

    if (needsRebuild) {
      try {
        await containerRebuild(app, msg => console.log(`[rebuild:${app.id}]`, msg));
        rebuilt.push(app.id);
      } catch (e) {
        console.error(`[rebuild:${app.id}] failed:`, e.message);
      }
    } else if (app.autorestart) {
      try {
        execSync(`docker restart ${containerName(app.id)}`, { timeout: 30000 });
        restarted.push(app.id);
      } catch {}
    }
  }

  const entry = { branch, repo, pusher, commitMsg, pullOutput, changedFiles, restarted, rebuilt };
  logEvent(entry);
  res.json({ ok: true, ...entry });
});

// ── WebSocket Terminal ─────────────────────────────────────────────────────────
// Each WS connection gets its own bash pty session.

const wss = new WebSocketServer({ server, path: "/terminal" });

wss.on("connection", (ws) => {
  const shell = pty.spawn("bash", [], {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: GIT_DIR,
    env: process.env,
  });

  shell.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data }));
  });

  shell.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "exit" }));
    ws.close();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "input") shell.write(msg.data);
      else if (msg.type === "resize") shell.resize(msg.cols, msg.rows);
    } catch {}
  });

  ws.on("close", () => shell.kill());
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(3000, () => {
  console.log("Launcher on :3000");
  console.log(`  HOST_REPO_PATH: ${HOST_REPO_PATH || "(not set — Linux/Mac host assumed)"}`);
  console.log(`  Webhook: ${WEBHOOK_SECRET ? "secured" : "UNSECURED — set WEBHOOK_SECRET"}`);
});
