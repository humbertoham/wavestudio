import { rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const lockPath = path.join(root, ".next", "dev", "lock");
const fullClean = process.env.CLEAN_NEXT_FULL === "1";

async function removeTarget(target, label) {
  try {
    await rm(target, { recursive: true, force: true });
    console.log(`Removed ${label}`);
  } catch (error) {
    console.warn(`Could not remove ${label}:`, error.message);
  }
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

await removeTarget(lockPath, ".next/dev/lock");

if (fullClean) {
  await removeTarget(path.join(root, ".next"), ".next");
}

if (await isPortBusy(3000)) {
  console.warn("Port 3000 is already in use. Stop the existing dev server or pass another port.");
}
