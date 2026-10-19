#!/usr/bin/env node
// Launcher: exec the platform binary. If it isn't here yet (e.g. bun skips postinstall
// scripts, or `npm --ignore-scripts`), download it now via install.js, then run it.
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const exe = process.platform === "win32" ? ".exe" : "";
const bin = path.join(__dirname, "omilo" + exe);

if (!fs.existsSync(bin)) {
  // postinstall may not have run — fetch the binary now (one time).
  try {
    execFileSync(process.execPath, [path.join(__dirname, "..", "install.js")], { stdio: "inherit" });
  } catch {
    /* install.js prints its own reason; the existence re-check below is authoritative */
  }
  if (!fs.existsSync(bin)) {
    console.error(
      "omilo: could not download the CLI binary for this platform.\n" +
        "See https://github.com/dedekrnwan/omilo-os#install for other install options."
    );
    process.exit(1);
  }
}

const res = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (res.error) {
  console.error(
    `omilo: failed to start (${res.error.message}).\n` +
      "Reinstall, or see https://github.com/dedekrnwan/omilo-os#install"
  );
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
