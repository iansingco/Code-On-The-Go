const express = require("express");
const { execSync } = require("child_process");
const { createHmac, timingSafeEqual } = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG_PATH = path.join(__dirname, "apps.config.json");
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT || "streaming";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const GIT_DIR = process.env.GIT_DIR || "/repo";

const deployLog = [];
function logEvent(e) {
  deployLog.unshift({ ...e, ts: new Date().toISOString() });
  if (deployLog.length > 20) deployLog.pop();
}

function loadApps() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return []; }
}

function containerName(id) { return `${COMPOSE_PROJECT}-${id}-1`; }

function containerStatus(id) {
  try {
    const out = execSync(
      `docker inspect --format='{{.State.Running}}' ${containerName(id)} 2>/dev/null`
    ).toString().trim();
    return out === "true" ? "running" : "stopped";
  } catch { return "stopped"; }
}

function containerUptime(id) {
  try {
    return execSync(
      `docker inspect --format='{{.State.StartedAt}}' ${containerName(id)} 2>/dev/null`
    ).toString().trim() || null;
  } catch { return null; }
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get("/api/apps", (req, res) => {
  res.json(loadApps().map(a => ({
    ...a,
    status: containerStatus(a.id),
    startedAt: containerUptime(a.id),
  })));
});

app.post("/api/apps/:id/start", (req, res) => {
  const a = loadApps().find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Unknown app" });
  try { execSync(`docker start ${containerName(req.params.id)}`); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apps/:id/stop", (req, res) => {
  const a = loadApps().find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Unknown app" });
  try { execSync(`docker stop ${containerName(req.params.id)}`); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/deploy/log", (req, res) => res.json(deployLog));

// ── Webhook ───────────────────────────────────────────────────────────────────

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

  let pullOutput = "";
  try { pullOutput = execSync(`git -C ${GIT_DIR} pull`, { timeout: 30000 }).toString().trim(); }
  catch (e) { pullOutput = `FAILED: ${e.message}`; }

  const restarted = [];
  for (const a of loadApps()) {
    if (!a.autorestart) continue;
    try { execSync(`docker restart ${containerName(a.id)}`, { timeout: 30000 }); restarted.push(a.id); }
    catch {}
  }

  const entry = { branch, repo, pusher, commitMsg, pullOutput, restarted };
  logEvent(entry);
  res.json({ ok: true, ...entry });
});

app.listen(3000, () => {
  console.log(`Launcher on :3000  project=${COMPOSE_PROJECT}  webhook=${WEBHOOK_SECRET ? "secured" : "UNSECURED"}`);
});
