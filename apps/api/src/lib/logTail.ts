import fs from "node:fs/promises";
import fsSync from "node:fs";

const READ_CHUNK = 64 * 1024;

export async function readLastLines(path: string, maxLines: number): Promise<{ lines: string[]; size: number }> {
  const stat = await fs.stat(path);
  const start = Math.max(0, stat.size - READ_CHUNK);

  const handle = await fs.open(path, "r");
  try {
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n").filter(Boolean);
    return { lines: lines.slice(-maxLines), size: stat.size };
  } finally {
    await handle.close();
  }
}

/**
 * Polls a log file for appended bytes and invokes `onLines` with any new,
 * complete lines. Cheaper than spawning a `tail -f` child process per
 * viewer, and handles truncation/rotation by resuming from the new EOF
 * instead of re-reading (or crashing on) a file that just got rotated out
 * from under it.
 */
export function watchLogFile(path: string, startSize: number, onLines: (lines: string[]) => void, intervalMs = 2000) {
  let lastSize = startSize;
  let stopped = false;

  const interval = setInterval(async () => {
    if (stopped) return;
    try {
      const stat = await fs.stat(path);
      if (stat.size < lastSize) {
        lastSize = stat.size;
        return;
      }
      if (stat.size === lastSize) return;

      const length = stat.size - lastSize;
      const buffer = Buffer.alloc(length);
      const handle = await fs.open(path, "r");
      try {
        await handle.read(buffer, 0, length, lastSize);
      } finally {
        await handle.close();
      }
      lastSize = stat.size;

      const lines = buffer.toString("utf8").split("\n").filter(Boolean);
      if (lines.length > 0) onLines(lines);
    } catch {
      // file may be mid-rotation; try again next tick
    }
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

export function fileExists(path: string): boolean {
  return fsSync.existsSync(path);
}
