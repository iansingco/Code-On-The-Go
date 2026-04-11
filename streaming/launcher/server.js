const express = require("express");
const { execSync, exec } = require("child_process");
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
function containerRebuild(app, onProgress) {
  if (!app.dockerfile) throw new Error("App has no dockerfile — nothing to rebuild");
  const tag = customImageTag(app.id);
  const ctx = resolveDockerfilePath(app.dockerfile);
  onProgress(`Building ${tag} from ${ctx}...`);
  execSync(`docker build -t ${tag} "${ctx}"`, { timeout: 300000 });
  onProgress("Build complete. Restarting container...");
  // Remove old container so docker run picks up the new image
  try { execSync(`docker stop ${containerName(app.id)} 2>/dev/null`); } catch {}
  try { execSync(`docker rm ${containerName(app.id)} 2>/dev/null`); } catch {}
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
app.get("/api/apps/:id/rebuild", (req, res) => {
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
    containerRebuild(app, send);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }
  res.end();
});

app.get("/api/deploy/log", (req, res) => res.json(deployLog));

// Clone a git repo into /repo/repos/<name>
app.post("/api/clone", (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });

  // Derive repo name from URL (strip .git suffix)
  const name = path.basename(url, ".git").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dest = path.join(GIT_DIR, "repos", name);

  if (fs.existsSync(dest)) return res.status(409).json({ error: `Already exists at repos/${name}` });

  try {
    fs.mkdirSync(path.join(GIT_DIR, "repos"), { recursive: true });
    execSync(`git clone "${url}" "${dest}"`, { timeout: 120000 });
    const stack = detectStack(dest);
    res.json({ ok: true, name, path: `repos/${name}`, stack });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CI/CD Webhook ─────────────────────────────────────────────────────────────

app.post("/webhook", (req, res) => {
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
        containerRebuild(app, msg => console.log(`[rebuild:${app.id}]`, msg));
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
