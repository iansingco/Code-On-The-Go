# Code-on-the-Go — Project Spec & Test Plan (v2)

> Template for Claude Code. Read fully before writing code. Start with **Phase 0 tests**; do not build the fork until they pass or a fallback is chosen.
>
> Supersedes the Kasm approach in `KASM README.md` / `streaming/` (Kasm needs a native Linux host; the host here is Windows + Docker Desktop/WSL2).

---

## 1. Goal

A **Windows thin client for the phone (or any screen)**: work from anywhere in a **focus window** — one remote app at a time, sized to the device, Moonlight-quality latency, opened in a browser.

- **Focus mode:** the current app fills the client screen. Switch apps with **Alt-Tab** (keyboard) or a **touch arrow** that cycles windows.
- **Peripherals first-class:** Bluetooth keyboard, mouse, gamepad, or USB-C dock to a monitor.
- **Agent chat is optional:** shown, hidden, or as a drawer, depending on the moment. The agent can do real work via MCP/tools even while hidden.

### Why this design
- Full-desktop streaming wastes small-screen real estate; one focused, device-sized window doesn't.
- iPhone has no split-screen between apps, so everything lives in **one web page** (PWA, Add to Home Screen).
- Chat must be **native HTML**, not streamed pixels, so iOS keyboard, dictation and copy-paste work.
- Browser = device-agnostic client (phone, tablet, laptop, TV, docked monitor).

### Prior art / why build
- **Apollo + native Moonlight**: excellent thin client, but whole desktop, no focus/switcher/agent, not embeddable.
- **Windows App (RDP)**: device-sized desktop, higher latency, weaker for GPU apps.
- **RemoteApp (RDS / AVD / Windows 365 / Citrix / Horizon)**: true per-window + alt-tab, but needs server licensing/infra.
- Nothing combines Moonlight-grade streaming + device-sized focus window + switching + browser client + optional agent. That's this project.

---

## 2. Environment

- **Host:** Windows PC, always-on, wired Ethernet. Docker Desktop (WSL2). Uses Sunshine/Apollo + Moonlight already.
- **Network:** Tailscale on host and clients (no port forwarding).
- **Clients:** iPhone (Safari / home-screen PWA) primary; also iPad, laptop browser, docked monitor.
- **Agent backend:** Claude API or local model (Ollama-style HTTP endpoint).
- **Do not use Kasm** (see note above).

---

## 3. Architecture

```
Client (PWA, one page)
├── Stream view: forked Moonlight-Web client   ◄── WebRTC ──┐
├── Switcher: ◀ ▶ touch arrows + window list ──► host helper│
└── Chat (optional: hidden | split | drawer) ──► agent ──► MCP tools
                                                            │
Windows host                                                │
├── Apollo (Sunshine fork)                                  │
│   └── virtual display sized to the STREAM VIEW res ───────┘
│       └── "focus desktop": taskbar hidden, work windows maximized
├── Moonlight-Web backend (GameStream ↔ WebRTC relay)
├── Host helper service (user session)
│   └── list/focus/cycle windows, keep them maximized on the
│       virtual display, /refresh, /status
└── Agent + MCP servers (file edits, app automation)
```

### Key mechanisms
1. **Device-sized display:** Apollo creates a virtual display at the client's requested resolution. The client requests its stream-view pixel size → windows fill it 1:1.
2. **Focus mode:** on the virtual display, auto-hide the taskbar and keep every work window maximized. One window = one full screen.
3. **Switching (two inputs, same result):**
   - **Keyboard:** Alt-Tab passes through the stream to Windows' native switcher. A configurable **focus key** (e.g. a chord the browser won't eat) also cycles via the host helper as a fallback.
   - **Touch:** **◀ / ▶ edge arrows** call `POST /windows/prev|next`; long-press opens a window list (`GET /windows`) to jump directly. The helper brings the target forward and maximizes it.
4. **Transport:** Moonlight-Web speaks GameStream to Apollo, relays video/audio/input to the browser over WebRTC (H.264 on the media-track path).
5. **Layout changes renegotiate resolution** (brief reconnect), so layout switches are explicit user actions, not every tiny resize.
6. **Agent → app sync:**
   - File-based apps (Godot): agent edits files; Godot auto-reloads externally changed scripts/scenes.
   - Locking apps (Word, Photoshop): agent drives the *running* app (COM for Office, UXP/ExtendScript for Photoshop). **MCP server must run in the same Windows session as the app.**
   - `POST /refresh` for app-specific reload.

---

## 4. Components to build

1. **Fork of Moonlight-Web** (GPL-3.0)
   - Render the stream inside a container that resizes with the active layout.
   - On load / rotation / layout change: compute container size × devicePixelRatio, request that resolution (debounced; reconnect only if Δ > ~8 px).
   - Map touch/mouse input to the container's coordinates; pass keyboard (incl. Alt-Tab where the browser allows).
   - Strip UI chrome not needed here.
2. **Shell page / PWA**
   - **Layout modes:** `focus` (stream full screen), `split` (stream + chat), `drawer` (stream full, chat slides over).
   - Default: `focus` when a hardware keyboard/mouse is detected, else last used.
   - **Switcher overlay:** semi-transparent ◀ ▶ edge arrows (auto-hide), long-press → window list.
   - **Device profiles:** saved resolution, Windows scaling, default layout per device (phone, iPad, laptop, docked).
3. **Chat pane** (optional)
   - Minimal HTML chat → configurable agent backend.
   - Buttons: Refresh app, Reconnect stream, Switch layout.
4. **Host helper service** (Windows, user session)
   - `GET /windows` — open top-level windows on the virtual display (title, exe, icon, id).
   - `POST /windows/next`, `/windows/prev`, `/windows/{id}/focus` — bring forward + maximize.
   - Launch named apps onto the virtual display; keep work windows maximized; hide taskbar while streaming.
   - `POST /refresh`, `GET /status`. Triggerable from Apollo `prep-cmd`.
5. **Apollo app entries:** a "Focus Desktop" entry (virtual display ON, runs the helper's focus setup) plus optional per-app entries (e.g. "Godot").

### Non-goals (v1)
- Multi-user, auth beyond Tailscale, internet exposure.
- Linux apps / containers (neko is inspiration only).
- Native iOS client (native Moonlight stays the fallback for heavy mouse/keyboard work).

---

## 5. Phase 0 — Feasibility tests (do these first)

### Test 1: Apollo with device/odd resolutions (~30 min)
1. Install Apollo (copy existing Sunshine config folder into Apollo's install dir). After pairing, **enable all permissions** for the client.
2. Add app **"Focus Desktop"**: "Always use virtual display" ON.
3. In Moonlight iOS try: native iPhone res, **1200×1200**, **1080×1080** (half-screen split).
4. **Pass:** stream starts; Display Settings shows the virtual monitor at that res; a maximized app fills it; text readable at 150–200% scaling.
5. **If fail:** standard 16:9 + letterbox in page. Record which resolutions work.
6. Known risk: Moonlight iOS "safe area / full custom" resolutions reported to fail.

### Test 2: Moonlight-Web in Safari (~30 min)
1. Install Moonlight-Web on the PC; pair with Apollo.
2. Open on iPhone via Tailscale in Safari → Add to Home Screen.
3. **Record:** stream starts (H.264); latency (overlay per-stage breakdown); touch + virtual keyboard; behavior after backgrounding and returning; full-screen without browser chrome.
4. **Combine with Test 1:** request the square res and view it in the top half of a resized page. Note whether Moonlight-Web can request a resolution matching its container (expected first fork change).
5. Known risk: Chrome/Edge recommended for full codec support; Safari may be H.264-only.

### Test 3: Peripherals & switching (~30 min)
1. iPhone/iPad + Bluetooth keyboard, mouse, gamepad, on both **native Moonlight** and **Moonlight-Web/Safari**.
2. **Record:**
   - Alt-Tab reaches Windows, or is it caught by iOS? Which chords pass through (candidate focus keys)?
   - Mouse: pointer works? relative motion / capture in Safari?
   - Gamepad detected (Gamepad API)?
3. Manual focus-mode check: taskbar auto-hide on, 3 apps maximized on the virtual display → Alt-Tab cycles full-screen windows cleanly.
4. **Optional dock test:** phone → USB-C monitor + keyboard/mouse; does the stream renegotiate to monitor res?

### Test 4 (optional): agent sync loop with Godot
1. Agent edits a `.gd` file while Godot is open on the virtual display.
2. **Pass:** change visible within a few seconds, no manual action.

### Decision gate
- Tests 1–2 pass → build Section 4.
- Test 1 fails → letterbox fallback, or evaluate ScreenExtend-style per-device virtual monitor.
- Test 2 fails on Safari → fallback viewer: OBS Window Capture → WHIP → MediaMTX (Docker) → WHEP `<video>` (view-only).
- Test 3: Alt-Tab blocked in browser → rely on focus key + touch arrows via host helper; native Moonlight for keyboard-heavy sessions.

---

## 6. Build phases (after Phase 0)

1. **P1 — Shell PWA:** Moonlight-Web in a container, `focus` layout only.
2. **P2 — Device-sized resolution:** fork to request container res; rotation; device profiles.
3. **P3 — Host helper + switcher:** `/windows` API, ◀ ▶ arrows, long-press list, focus key, taskbar hide/auto-maximize.
4. **P4 — Layout modes:** `split` and `drawer`; explicit layout switch with renegotiation.
5. **P5 — Chat → agent:** wire chat; Refresh/Reconnect buttons.
6. **P6 — App adapters:** Godot first (file-based), then one COM-driven app (Word) to validate same-session MCP.

---

## 7. References

| Project | Use |
|---|---|
| Moonlight-Web — https://github.com/linckosz/moonlight-web | Browser Moonlight client to fork (GPL-3.0) |
| Apollo — https://github.com/ClassicOldSong/Apollo | Sunshine fork; per-client virtual display |
| ScreenExtend — https://github.com/ramalingamthangamani/ScreenExtend | Windows: per-device virtual monitor via Parsec VDD, browser client (closest prior art) |
| DeskSlice — https://github.com/frudas24/deskslice | Windows: stream a region of VS Code to phone via WebRTC + input calibration |
| FoldCast — https://github.com/kentaro/foldcast | macOS: virtual display auto-resized to phone viewport (design reference) |
| neko — https://github.com/m1k1o/neko | WebRTC single-app streaming, Linux (inspiration only) |
| MediaMTX — https://github.com/bluenviron/mediamtx | WHIP/WHEP fallback viewer |

---

## 8. Open questions
- Which key chord to use as the focus key (must survive iOS + Safari)?
- Window list scope: all windows on the virtual display, or a pinned "work set"?
- Default layout per device; should rotation switch layout (portrait = split, landscape = focus)?
- Agent backend default (Claude API vs local); where MCP servers run (same session as COM apps).
- Audio on or muted by default?
