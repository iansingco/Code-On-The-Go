const express = require("express");
const { execSync, execFile } = require("child_process");
const { createHmac, timingSafeEqual } = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

// Raw body needed for webhook signature verification
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "apps.config.json");
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT || "streaming";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const GIT_DIR = process.env.GIT_DIR || "/repo";

function loadApps() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error("Failed to load apps.config.json:", e.message);
    return [];
  }
}

// ── Deployment log (in-memory, last 20 events) ────────────────────────────────

const deployLog = [];
function logEvent(event) {
  deployLog.unshift({ ...event, ts: new Date().toISOString() });
  if (deployLog.length > 20) deployLog.pop();
}

// ── Docker helpers ────────────────────────────────────────────────────────────

function containerName(appId) {
  return `${COMPOSE_PROJECT}-${appId}-1`;
}

function containerStatus(appId) {
  try {
    const out = execSync(
      `docker inspect --format='{{.State.Running}}' ${containerName(appId)} 2>/dev/null`
    ).toString().trim();
    return out === "true" ? "running" : "stopped";
  } catch {
    return "stopped";
  }
}

function containerUptime(appId) {
  try {
    const out = execSync(
      `docker inspect --format='{{.State.StartedAt}}' ${containerName(appId)} 2>/dev/null`
    ).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

// ── API routes ────────────────────────────────────────────────────────────────

app.get("/api/apps", (req, res) => {
  const apps = loadApps();
  res.json(apps.map((a) => ({
    ...a,
    status: containerStatus(a.id),
    startedAt: containerUptime(a.id),
  })));
});

app.post("/api/apps/:id/start", (req, res) => {
  const { id } = req.params;
  const apps = loadApps();
  if (!apps.find((a) => a.id === id)) {
    return res.status(404).json({ error: "Unknown app" });
  }
  try {
    execSync(`docker start ${containerName(id)}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/apps/:id/stop", (req, res) => {
  const { id } = req.params;
  const apps = loadApps();
  if (!apps.find((a) => a.id === id)) {
    return res.status(404).json({ error: "Unknown app" });
  }
  try {
    execSync(`docker stop ${containerName(id)}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/deploy/log", (req, res) => {
  res.json(deployLog);
});

// ── CI/CD Webhook (GitHub) ────────────────────────────────────────────────────
//
// Configure in GitHub: Settings → Webhooks → Add webhook
//   Payload URL:  http://<tailscale-ip>:8080/webhook
//   Content type: application/json
//   Secret:       value of WEBHOOK_SECRET in .env
//   Events:       Just the push event

app.post("/webhook", (req, res) => {
  // Verify signature if a secret is configured
  if (WEBHOOK_SECRET) {
    const sig = req.headers["x-hub-signature-256"];
    if (!sig) {
      return res.status(401).json({ error: "Missing signature" });
    }
    const expected = "sha256=" + createHmac("sha256", WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");
    try {
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    } catch {
      return res.status(401).json({ error: "Signature error" });
    }
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: "Bad JSON" });
  }

  const ref = payload.ref || "";
  const branch = ref.replace("refs/heads/", "");
  const repo = payload.repository?.full_name || "unknown";
  const pusher = payload.pusher?.name || "unknown";
  const commitMsg = payload.head_commit?.message?.split("\n")[0] || "";

  console.log(`[webhook] push to ${repo}@${branch} by ${pusher}: ${commitMsg}`);

  // Pull latest code
  let pullOutput = "";
  try {
    pullOutput = execSync(`git -C ${GIT_DIR} pull`, { timeout: 30000 }).toString().trim();
    console.log("[webhook] git pull:", pullOutput);
  } catch (e) {
    console.error("[webhook] git pull failed:", e.message);
    pullOutput = `FAILED: ${e.message}`;
  }

  // Restart containers that have autorestart: true
  const apps = loadApps();
  const restarted = [];
  for (const a of apps) {
    if (!a.autorestart) continue;
    try {
      execSync(`docker restart ${containerName(a.id)}`, { timeout: 30000 });
      restarted.push(a.id);
      console.log(`[webhook] restarted ${a.id}`);
    } catch (e) {
      console.error(`[webhook] restart ${a.id} failed:`, e.message);
    }
  }

  const entry = { branch, repo, pusher, commitMsg, pullOutput, restarted };
  logEvent(entry);

  res.json({ ok: true, ...entry });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Launcher running on :${PORT}`);
  console.log(`  Apps config: ${CONFIG_PATH}`);
  console.log(`  Project:     ${COMPOSE_PROJECT}`);
  console.log(`  Webhook:     ${WEBHOOK_SECRET ? "secured" : "UNSECURED — set WEBHOOK_SECRET"}`);
});
