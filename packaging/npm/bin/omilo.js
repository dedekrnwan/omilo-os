#!/usr/bin/env node
// Thin launcher: exec the platform binary that install.js placed next to this file,
// passing through all args, stdio, and the exit code.
const path = require("path");
const { spawnSync } = require("child_process");

const exe = process.platform === "win32" ? ".exe" : "";
const bin = path.join(__dirname, "omilo" + exe);

const res = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (res.error) {
  console.error(
    `omilo: binary not found or failed to start (${res.error.message}).\n` +
      `Try reinstalling: npm i -g omilo  —  or see https://github.com/dedekrnwan/omilo-os#install`
  );
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
