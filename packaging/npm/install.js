// Downloads the prebuilt `omilo` binary for this platform from the matching GitHub release
// into ./bin, so `npx omilo` / `bunx omilo` and a normal `npm i -g omilo` all work.
// Runs as a postinstall step. The release assets are named omilo_<goos>_<goarch>.tar.gz
// (or .zip on Windows), each containing a single binary omilo_<goos>_<goarch>[.exe].
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const https = require("https");
const zlib = require("zlib");

const REPO = "dedekrnwan/omilo-os";
const VERSION = require("./package.json").version; // set to the release version at publish time

const GOOS = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
const GOARCH = { x64: "amd64", arm64: "arm64" }[process.arch];
const binDir = path.join(__dirname, "bin");
const exe = process.platform === "win32" ? ".exe" : "";
const binName = "omilo" + exe;

function fail(msg) {
  console.error(
    `\nomilo: ${msg}\n` +
      `Download a binary from https://github.com/${REPO}/releases/tag/v${VERSION}\n` +
      `or install another way: https://github.com/${REPO}#install\n`
  );
  // Exit 0 so a failed postinstall never breaks `npm i -g` / `bun add -g`; the launcher
  // (bin/omilo.js) re-checks for the binary and is the authoritative gate.
  process.exit(0);
}

if (!GOOS || !GOARCH) fail(`unsupported platform ${process.platform}/${process.arch}`);

const asset = `omilo_${GOOS}_${GOARCH}` + (GOOS === "windows" ? ".zip" : ".tar.gz");
const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${asset}`;

function get(u, cb, redirects = 0) {
  https.get(u, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      if (redirects > 5) return fail("too many redirects");
      res.resume();
      return get(res.headers.location, cb, redirects + 1);
    }
    if (res.statusCode !== 200) return fail(`download failed (HTTP ${res.statusCode}) from ${u}`);
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => cb(Buffer.concat(chunks)));
  }).on("error", (e) => fail(`download error: ${e.message}`));
}

fs.mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, binName);

get(url, (buf) => {
  try {
    if (GOOS === "windows") {
      // Minimal: write the .zip and extract the single entry via PowerShell.
      const zip = path.join(binDir, asset);
      fs.writeFileSync(zip, buf);
      execFileSync("powershell", ["-NoProfile", "-Command",
        `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${binDir}'`]);
      fs.renameSync(path.join(binDir, `omilo_${GOOS}_${GOARCH}${exe}`), dest);
      fs.unlinkSync(zip);
    } else {
      const tar = zlib.gunzipSync(buf);
      // The tarball has one regular file; extract it without a tar dependency.
      extractSingleFromTar(tar, dest);
      fs.chmodSync(dest, 0o755);
    }
    console.log(`omilo ${VERSION} installed (${GOOS}/${GOARCH})`);
  } catch (e) {
    fail(`could not unpack ${asset}: ${e.message}`);
  }
});

// Tiny tar reader: finds the omilo binary entry and writes its bytes to `out`.
// Skips AppleDouble (._*) and pax/global headers that macOS bsdtar may prepend, so a
// tarball built on any OS works.
function extractSingleFromTar(tar, out) {
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.slice(off, off + 512);
    const name = header.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break; // end-of-archive
    const size = parseInt(header.slice(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
    const type = header[156];
    const start = off + 512;
    const base = name.split("/").pop();
    const isRegular = type === 0 || type === 48 /* '0' */;
    const junk = base.startsWith("._") || name.includes("PaxHeader") || name.includes("@LongLink");
    if (isRegular && !junk && base.startsWith("omilo_")) {
      fs.writeFileSync(out, tar.slice(start, start + size));
      return;
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("no omilo binary in archive");
}
