const express = require("express");
const { execSync } = require("child_process");
const { createHmac, timingSafeEqual } = require("crypto");
const path = require("path");

const app = express();

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const KASM_URL = process.env.KASM_URL || "https://localhost:8443";
const GIT_DIR = process.env.GIT_DIR || "/repo";

// In-memory deploy log (last 20 events)
const deployLog = [];
function logEvent(event) {
  deployLog.unshift({ ...event, ts: new Date().toISOString() });
  if (deployLog.length > 20) deployLog.pop();
}

// ── Status API ────────────────────────────────────────────────────────────────

app.get("/api/status", (req, res) => {
  let gitHead = null;
  try {
    gitHead = execSync(`git -C ${GIT_DIR} log -1 --format="%h %s" 2>/dev/null`)
      .toString().trim();
  } catch {}
  res.json({ kasmUrl: KASM_URL, gitHead, deployLog });
});

// ── CI/CD Webhook ─────────────────────────────────────────────────────────────
//
// Configure in GitHub: Settings → Webhooks → Add webhook
//   Payload URL:  http://<tailscale-ip>:8080/webhook
//   Content type: application/json
//   Secret:       value of WEBHOOK_SECRET in .env
//   Events:       Just the push event

app.post("/webhook", (req, res) => {
  if (WEBHOOK_SECRET) {
    const sig = req.headers["x-hub-signature-256"];
    if (!sig) return res.status(401).json({ error: "Missing signature" });
    const expected = "sha256=" + createHmac("sha256", WEBHOOK_SECRET)
      .update(req.body).digest("hex");
    try {
      const a = Buffer.from(sig), b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b))
        return res.status(401).json({ error: "Invalid signature" });
    } catch {
      return res.status(401).json({ error: "Signature error" });
    }
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: "Bad JSON" }); }

  const branch = (payload.ref || "").replace("refs/heads/", "");
  const repo = payload.repository?.full_name || "unknown";
  const pusher = payload.pusher?.name || "unknown";
  const commitMsg = payload.head_commit?.message?.split("\n")[0] || "";

  console.log(`[webhook] push ${repo}@${branch} by ${pusher}: ${commitMsg}`);

  // Pull latest code
  let pullOutput = "";
  try {
    pullOutput = execSync(`git -C ${GIT_DIR} pull`, { timeout: 30000 }).toString().trim();
    console.log("[webhook] git pull:", pullOutput);
  } catch (e) {
    pullOutput = `FAILED: ${e.message}`;
    console.error("[webhook] git pull failed:", e.message);
  }

  // Optionally rebuild workspace images (runs in background, non-blocking)
  // To trigger: set REBUILD_WORKSPACES=true in .env
  let rebuildNote = null;
  if (process.env.REBUILD_WORKSPACES === "true") {
    rebuildNote = "Workspace rebuild triggered (check docker logs webhook)";
    setTimeout(() => {
      try {
        execSync(`docker build -t claude-code-workspace ${GIT_DIR}/streaming/workspaces/claude-code`, {
          timeout: 300000,
          stdio: "inherit",
        });
        console.log("[webhook] workspace image rebuilt");
      } catch (e) {
        console.error("[webhook] rebuild failed:", e.message);
      }
    }, 100);
  }

  const entry = { branch, repo, pusher, commitMsg, pullOutput, rebuildNote };
  logEvent(entry);
  res.json({ ok: true, ...entry });
});

app.listen(3000, () => {
  console.log("Webhook server on :3000");
  console.log(`  KASM portal: ${KASM_URL}`);
  console.log(`  Webhook:     ${WEBHOOK_SECRET ? "secured" : "UNSECURED — set WEBHOOK_SECRET"}`);
});
