#!/usr/bin/env node
// Omilo self-host launcher — drives `docker compose` for the local runtime.
// Default mode: OMILO_MODE=local (free, BYO AI, no cloud env needed).
// NO external downloads, NO remote execution. Requires Docker (Desktop or Engine).
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

// ── Resolve the bundled runtime compose file ─────────────────────────────────
// When installed via npx, the compose file ships alongside this script under
// ../deploy/docker-compose.runtime.yml (see package.json "files").
// In a dev checkout the same relative path resolves to the repo copy.
const COMPOSE_FILE = (() => {
  const bundled = path.join(__dirname, "..", "deploy", "docker-compose.runtime.yml");
  // Prefer the bundled copy; fall back to repo root relative to cwd (dev convenience).
  try {
    require("fs").accessSync(bundled);
    return bundled;
  } catch {
    return path.join(process.cwd(), "deploy", "docker-compose.runtime.yml");
  }
})();

const LOCAL_URL = "http://localhost:7700";

// ── Help text ────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
Omilo CLI — self-host launcher

  Default mode: local — free, BYO AI keys, no cloud account required.
  Your workspace data stays on your machine. Pooled/metered inference
  is disabled in local mode; bring your own API keys in the UI.

  Run \`omilo connect\` to upgrade to hybrid mode: cloud identity +
  pooled credits, data stays local.

Prerequisite: Docker Desktop (or Docker Engine with the Compose plugin).
  Install: https://docs.docker.com/get-docker/

Usage:
  omilo up          Start Omilo locally (local mode, free, BYO AI, no cloud).
  omilo connect     Upgrade to hybrid mode — sign in to cloud, get pooled credits.
  omilo down        Stop and remove the runtime containers.
  omilo logs        Stream live logs (Ctrl-C to stop).
  omilo --help      Show this help.

Modes:
  local   (default) — free, BYO AI keys, no cloud env needed, fully private.
  hybrid            — cloud identity + pooled credits; run \`omilo connect\`.
  cloud             — vendor control plane; see docs/technical/12-control-plane-runtime-split.md §10.

Environment (optional, in deploy/.env.runtime — hybrid mode only):
  OMILO_MODE                Set to "hybrid" after running omilo connect.
  OMILO_CONTROL_PLANE_URL   Cloud control plane URL (default: https://api.omilo.app).
  OMILO_INSTALL_TOKEN       Install token obtained via: omilo connect.

Quickstart (local, no cloud account needed):
  npx omilo up
  # Then visit: http://localhost:7700
  # Add your AI provider key in Settings → AI Keys.

Upgrade to hybrid (cloud identity + pooled credits):
  npx omilo connect
`);
}

// ── Docker detection ─────────────────────────────────────────────────────────
// Returns true only if both `docker` and `docker compose` are present and working.
function isDockerAvailable() {
  const result = spawnSync("docker", ["compose", "version"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  // ENOENT → docker not installed; non-zero status → compose plugin missing/broken.
  return result.status === 0 && !result.error;
}

function requireDocker() {
  if (!isDockerAvailable()) {
    console.error(
      "\nomilo: Docker (with the Compose plugin) is required but was not found.\n\n" +
      "  Install Docker Desktop:  https://www.docker.com/products/docker-desktop/\n" +
      "  Install Docker Engine:   https://docs.docker.com/engine/install/\n\n" +
      "  If Docker is installed but not on your PATH, open a new terminal session\n" +
      "  or add Docker to PATH, then re-run this command.\n"
    );
    process.exit(1);
  }
}

// ── spawnSync helper — inherits stdio + propagates exit codes ────────────────
function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.error) {
    console.error(`omilo: failed to run '${cmd}': ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status === null ? 1 : res.status);
}

// ── Resolve env file (alongside compose, or in cwd/deploy/) ─────────────────
function resolveEnvFile() {
  const candidates = [
    path.join(path.dirname(COMPOSE_FILE), ".env.runtime"),
    path.join(process.cwd(), "deploy", ".env.runtime"),
  ];
  for (const f of candidates) {
    try { require("fs").accessSync(f); return f; } catch { /* try next */ }
  }
  return null;
}

// ── Commands ─────────────────────────────────────────────────────────────────
const [,, cmd, ...rest] = process.argv;

switch (cmd) {

  case "up": {
    requireDocker();
    const envFile = resolveEnvFile();

    const args = [
      "compose", "-f", COMPOSE_FILE,
      ...(envFile ? ["--env-file", envFile] : []),
      "up", "-d", "--wait",
    ];

    console.log("omilo: starting local runtime…");
    const res = spawnSync("docker", args, { stdio: "inherit" });
    if (res.error) {
      console.error(`omilo: failed to run docker compose: ${res.error.message}`);
      process.exit(1);
    }
    const status = res.status === null ? 1 : res.status;
    if (status === 0) {
      console.log(`
omilo: runtime is up! Open: ${LOCAL_URL}

  Running locally — free, BYO AI, no cloud account required.
  Add your AI provider key in Settings → AI Keys.

  To enable cloud identity + pooled credits, run: omilo connect
`);
    }
    process.exit(status);
  }

  case "connect": {
    // Upgrade this install from local to hybrid mode.
    // Runs `omilo-connect` inside the api container, which guides the user
    // through cloud sign-in, issues an install token, re-keys tenant data,
    // and sets OMILO_MODE=hybrid in the env file.
    console.log(`
omilo connect — upgrade to hybrid mode

  This will sign you in to the Omilo cloud, issue an install token,
  and switch this install to hybrid mode (cloud identity + pooled credits).
  Your workspace data stays on this machine.

  The runtime stack must be running. Start it first if needed:
    omilo up
`);

    if (!isDockerAvailable()) {
      console.error(
        "omilo: Docker is not available — start Docker first, then run: omilo up\n" +
        "       Once the stack is running, re-run: omilo connect\n"
      );
      process.exit(1);
    }

    // Check if the api container is running.
    const psRes = spawnSync(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "ps", "--status", "running", "--services"],
      { stdio: "pipe", encoding: "utf8" }
    );
    const runningServices = psRes.status === 0 ? (psRes.stdout || "").trim() : "";
    const apiRunning = runningServices.includes("api");

    if (!apiRunning) {
      console.log(
        "omilo: the runtime stack is not up. Start it first:\n\n" +
        "  omilo up\n\n" +
        "Then re-run: omilo connect\n\n" +
        "Or run the connect command manually once the stack is up:\n" +
        `  docker compose -f ${COMPOSE_FILE} exec api omilo-connect\n`
      );
      process.exit(1);
    }

    run("docker", ["compose", "-f", COMPOSE_FILE, "exec", "api", "omilo-connect"]);
    break;
  }

  case "down": {
    requireDocker();
    run("docker", ["compose", "-f", COMPOSE_FILE, "down"]);
    break;
  }

  case "logs": {
    requireDocker();
    run("docker", ["compose", "-f", COMPOSE_FILE, "logs", "-f", "--tail", "100"]);
    break;
  }

  case "--help":
  case "-h":
  case undefined: {
    printHelp();
    process.exit(0);
    break;
  }

  default: {
    console.error(`omilo: unknown command '${cmd}'\n`);
    printHelp();
    process.exit(1);
  }
}
