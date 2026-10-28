#!/usr/bin/env node
// Omilo local-runtime launcher — drives `docker compose` against the cloud control plane.
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
Omilo CLI — local runtime launcher

  Identity & billing are handled by the Omilo cloud control plane
  (OMILO_CONTROL_PLANE_URL, default: https://api.omilo.app).
  Your workspace data (messages, RAG, connectors) stays on your machine.

Prerequisite: Docker Desktop (or Docker Engine with the Compose plugin).
  Install: https://docs.docker.com/get-docker/

Usage:
  omilo up          Start the local Omilo runtime (builds images, pulls deps).
  omilo down        Stop and remove the runtime containers.
  omilo logs        Stream live logs (Ctrl-C to stop).
  omilo register    Register this install with the Omilo cloud (first-run setup).
  omilo --help      Show this help.

Environment (in deploy/.env.runtime):
  OMILO_CONTROL_PLANE_URL   Cloud control plane URL (default: https://api.omilo.app).
  OMILO_INSTALL_TOKEN       Install token obtained via: omilo register.

Quickstart:
  npx omilo up
  # Then visit: http://localhost:7700
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

// ── Commands ─────────────────────────────────────────────────────────────────
const [,, cmd, ...rest] = process.argv;

switch (cmd) {

  case "up": {
    requireDocker();
    // Check for an env-file alongside the compose file (convenience).
    const envFile = path.join(path.dirname(COMPOSE_FILE), ".env.runtime");
    const envFileExists = (() => {
      try { require("fs").accessSync(envFile); return true; } catch { return false; }
    })();

    const args = [
      "compose", "-f", COMPOSE_FILE,
      ...(envFileExists ? ["--env-file", envFile] : []),
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

  Identity & billing use the Omilo cloud control plane (OMILO_CONTROL_PLANE_URL).
  Your workspace data stays on this machine — it never leaves.

  If you haven't registered this install yet, run: omilo register
`);
    }
    process.exit(status);
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

  case "register": {
    // Guide the user through the install registration flow.
    // Attempts to exec `omilo-register` inside the api container.
    // If the stack is not up, prints the exact manual command.
    console.log(`
omilo register — connect this install to the Omilo cloud

  Step 1: Sign in to the Omilo cloud at https://app.omilo.app
          (or https://OMILO_CONTROL_PLANE_URL if self-hosting the control plane).

  Step 2: This command will run the registration script inside the api container.
          When it completes, copy the printed install token.

  Step 3: Add the token to deploy/.env.runtime:
            OMILO_INSTALL_TOKEN=<printed token>
          Then restart with: omilo down && omilo up
`);

    if (!isDockerAvailable()) {
      console.error(
        "omilo: Docker is not available — start Docker first, then run: omilo up\n" +
        "       Once the stack is running, re-run: omilo register\n"
      );
      process.exit(1);
    }

    // Check if the stack is running by looking for the api container.
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
        "Then re-run: omilo register\n\n" +
        "Or run the registration command manually once the stack is up:\n" +
        `  docker compose -f ${COMPOSE_FILE} exec api omilo-register\n`
      );
      process.exit(1);
    }

    run("docker", ["compose", "-f", COMPOSE_FILE, "exec", "api", "omilo-register"]);
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
