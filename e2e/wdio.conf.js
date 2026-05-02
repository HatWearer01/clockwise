import { spawn, execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const binaryPath = join(
  rootDir,
  "src-tauri",
  "target",
  "debug",
  "clockwise.exe"
);
const dataDir = join(rootDir, "src-tauri", "target", "debug", "data");

let tauriDriver;

export const config = {
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: binaryPath,
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  hostname: "localhost",
  port: 4444,

  async onPrepare() {
    // Build debug binary (no bundling — faster)
    console.log("Building debug binary...");
    execSync("npx tauri build --debug --no-bundle", {
      cwd: rootDir,
      stdio: "inherit",
    });

    // Clean data directory for fresh state
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
      console.log("Cleaned data directory for fresh smoke test run.");
    }
  },

  async beforeSession() {
    // Download/resolve msedgedriver via the edgedriver npm package
    const edgedriver = await import("edgedriver");
    const edgeDriverPath = await edgedriver.download();
    console.log(`msedgedriver at: ${edgeDriverPath}`);

    // Spawn tauri-driver on port 4444 with the native driver path
    tauriDriver = spawn(
      "tauri-driver",
      ["--native-driver", edgeDriverPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    tauriDriver.stdout.on("data", (data) => {
      process.stdout.write(`[tauri-driver] ${data}`);
    });
    tauriDriver.stderr.on("data", (data) => {
      process.stderr.write(`[tauri-driver] ${data}`);
    });

    // Wait for tauri-driver to start listening
    await new Promise((r) => setTimeout(r, 3000));
  },

  afterSession() {
    if (tauriDriver) {
      tauriDriver.kill();
      tauriDriver = null;
    }
  },
};
