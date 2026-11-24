import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const fixtures = [];
afterEach(() => { for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function runPackage(signatureMode) {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-package-test-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "temporary"));
  copyFileSync(fileURLToPath(new URL("../../scripts/package-macos.sh", import.meta.url)), join(root, "scripts/package-macos.sh"));
  const command = (name, source) => writeFileSync(join(bin, name), `#!/bin/sh\n${source}\n`, { mode: 0o755 });
  command("uname", "printf 'Darwin\\n'");
  command("npm", 'mkdir -p "$CARGO_TARGET_DIR/release/bundle/macos/Heartbeat Chime Community.app/Contents/MacOS"\nprintf executable > "$CARGO_TARGET_DIR/release/bundle/macos/Heartbeat Chime Community.app/Contents/MacOS/app"');
  command("ditto", 'cp -R "$1" "$2"');
  command("codesign", `printf '%s\\n' "$*" >> "$SIGNATURE_LOG"
for heartbeat_arg do heartbeat_last_arg=$heartbeat_arg; done
case "$1" in
  --verify) [ "$SIGNATURE_MODE" = valid ] || [ -f "$heartbeat_last_arg/.local-signature" ] ;;
  -d)
    case "$SIGNATURE_MODE" in
      adhoc) printf 'Signature=adhoc\\n' >&2 ;;
      unsigned) printf 'code object is not signed at all\\n' >&2; exit 1 ;;
      *) printf 'Authority=Developer ID Application: Test Fixture\\n' >&2 ;;
    esac ;;
  --force) touch "$heartbeat_last_arg/.local-signature" ;;
  *) exit 2 ;;
esac`);
  const log = join(root, "signature.log");
  const result = spawnSync("sh", [join(root, "scripts/package-macos.sh")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: join(root, "temporary"), SIGNATURE_MODE: signatureMode, SIGNATURE_LOG: log }
  });
  return { root, result, signatureCalls: readFileSync(log, "utf8") };
}

describe("macOS durable packaging signature boundary", () => {
  it("preserves a valid developer signature and removes only its private target", () => {
    const { root, result, signatureCalls } = runPackage("valid");
    expect(result.status).toBe(0);
    expect(signatureCalls).not.toContain("--force");
    expect(readdirSync(join(root, "temporary"))).toEqual([]);
    const artifact = readdirSync(join(root, "artifacts"))[0];
    expect(existsSync(join(root, "artifacts", artifact, "Heartbeat Chime Community.app/Contents/MacOS/app"))).toBe(true);
  });

  it.each(["adhoc", "unsigned"])("seals a %s local build and verifies the staged bundle", (mode) => {
    const { root, result, signatureCalls } = runPackage(mode);
    expect(result.status).toBe(0);
    expect(signatureCalls).toContain("--force --sign -");
    expect(signatureCalls.trim().split("\n").at(-1)).toContain("--verify --deep --strict");
    expect(readdirSync(join(root, "temporary"))).toEqual([]);
  });

  it("refuses to replace a failed developer signature", () => {
    const { root, result, signatureCalls } = runPackage("invalid-developer");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to replace");
    expect(signatureCalls).not.toContain("--force");
    expect(readdirSync(join(root, "temporary"))).toEqual([]);
  });
});
