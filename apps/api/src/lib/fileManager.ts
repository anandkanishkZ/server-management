import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FileRoot {
  id: string;
  label: string;
  path: string;
}

// Deliberately narrow: only the actual hosted-app directories, not the whole
// filesystem. Add more roots here as needed, never accept an arbitrary path
// from the client.
//
// Rooted under the panel's own OS user's home directory - home directories
// are 0700 by default, so this only works when PANEL_OS_USER is the same
// account the API process runs as (which is how the installer sets it up).
const PANEL_OS_USER = process.env.PANEL_OS_USER ?? "ubuntu";
const ROOTS: FileRoot[] = [{ id: "apps", label: "Hosted Apps", path: `/home/${PANEL_OS_USER}/app` }];

const MAX_EDITABLE_SIZE = 2 * 1024 * 1024; // 2 MB
const TRASH_DIR = ".panel-trash";
const MANIFEST_FILE = "manifest.json";

const TYPE_BY_EXT: Record<string, string> = {
  ".js": "JavaScript",
  ".ts": "TypeScript",
  ".tsx": "TypeScript (JSX)",
  ".jsx": "JavaScript (JSX)",
  ".json": "JSON",
  ".php": "PHP script",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".md": "Markdown",
  ".txt": "Plain text",
  ".sql": "SQL",
  ".env": "Environment config",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".png": "Image",
  ".jpg": "Image",
  ".jpeg": "Image",
  ".gif": "Image",
  ".svg": "Image (SVG)",
  ".zip": "Archive",
  ".tar": "Archive",
  ".gz": "Archive",
  ".pdf": "PDF",
  ".log": "Log file",
};

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  mode: string;
  type: string;
}

export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  isDirectory: boolean;
  size: number;
  deletedAt: string;
}

function getRoot(rootId: string): FileRoot {
  const root = ROOTS.find((r) => r.id === rootId);
  if (!root) throw new Error(`unknown root "${rootId}"`);
  return root;
}

/**
 * Resolves a client-supplied relative path against a fixed root and verifies
 * the result is still inside that root - the entire defense against path
 * traversal (`../../etc/passwd` etc.) lives here.
 */
export function resolvePath(rootId: string, relativePath: string): string {
  const root = getRoot(rootId);
  const cleaned = (relativePath || "/").replace(/\\/g, "/");
  const resolved = path.resolve(root.path, `.${cleaned}`);

  if (resolved !== root.path && !resolved.startsWith(root.path + path.sep)) {
    throw new Error("path escapes the allowed root");
  }
  return resolved;
}

function assertSimpleName(name: string, label = "name") {
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(`invalid ${label}`);
  }
}

function formatMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function fileType(name: string, isDirectory: boolean): string {
  if (isDirectory) return "Directory";
  const ext = path.extname(name).toLowerCase();
  return TYPE_BY_EXT[ext] ?? (ext ? `${ext.slice(1).toUpperCase()} file` : "File");
}

export function listRoots(): FileRoot[] {
  return ROOTS;
}

export async function listDir(rootId: string, relativePath: string): Promise<DirEntry[]> {
  const fullPath = resolvePath(rootId, relativePath);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });

  const results = await Promise.all(
    entries
      .filter((entry) => entry.name !== TRASH_DIR)
      .map(async (entry): Promise<DirEntry> => {
        const stat = await fs.stat(path.join(fullPath, entry.name)).catch(() => null);
        const isDirectory = entry.isDirectory();
        return {
          name: entry.name,
          isDirectory,
          size: stat?.size ?? 0,
          modifiedAt: stat?.mtime.toISOString() ?? "",
          mode: stat ? formatMode(stat.mode) : "---",
          type: fileType(entry.name, isDirectory),
        };
      })
  );

  return results.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
}

export async function readFileContent(rootId: string, relativePath: string): Promise<{ content: string; truncated: boolean }> {
  const fullPath = resolvePath(rootId, relativePath);
  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) throw new Error("is a directory");
  if (stat.size > MAX_EDITABLE_SIZE) {
    return { content: "", truncated: true };
  }
  const content = await fs.readFile(fullPath, "utf8");
  return { content, truncated: false };
}

export async function writeFileContent(rootId: string, relativePath: string, content: string): Promise<void> {
  const fullPath = resolvePath(rootId, relativePath);
  await fs.writeFile(fullPath, content, "utf8");
}

export async function createFile(rootId: string, dirPath: string, name: string): Promise<void> {
  assertSimpleName(name);
  const dir = resolvePath(rootId, dirPath);
  await fs.writeFile(path.join(dir, name), "", { flag: "wx" });
}

export async function makeDir(rootId: string, relativePath: string, name: string): Promise<void> {
  assertSimpleName(name, "folder name");
  const parent = resolvePath(rootId, relativePath);
  await fs.mkdir(path.join(parent, name), { recursive: false });
}

export async function renameEntry(rootId: string, relativePath: string, newName: string): Promise<void> {
  assertSimpleName(newName);
  const fullPath = resolvePath(rootId, relativePath);
  const dest = path.join(path.dirname(fullPath), newName);
  if (!dest.startsWith(getRoot(rootId).path)) throw new Error("path escapes the allowed root");
  await fs.rename(fullPath, dest);
}

export async function copyEntry(rootId: string, srcRelative: string, destRelative: string): Promise<void> {
  const src = resolvePath(rootId, srcRelative);
  const dest = resolvePath(rootId, destRelative);
  await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
}

export async function moveEntry(rootId: string, srcRelative: string, destRelative: string): Promise<void> {
  const src = resolvePath(rootId, srcRelative);
  const dest = resolvePath(rootId, destRelative);
  if (fsSync.existsSync(dest)) throw new Error("a file or folder already exists at the destination");
  await fs.rename(src, dest);
}

export async function chmodEntry(rootId: string, relativePath: string, mode: string): Promise<void> {
  if (!/^[0-7]{3,4}$/.test(mode)) throw new Error(`invalid permission mode "${mode}"`);
  const fullPath = resolvePath(rootId, relativePath);
  await fs.chmod(fullPath, parseInt(mode, 8));
}

export function resolveDownloadPath(rootId: string, relativePath: string): string {
  return resolvePath(rootId, relativePath);
}

// --- Trash ------------------------------------------------------------

interface Manifest {
  [id: string]: { name: string; originalPath: string; isDirectory: boolean; deletedAt: string };
}

async function trashDirFor(rootId: string): Promise<string> {
  const root = getRoot(rootId);
  const dir = path.join(root.path, TRASH_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readManifest(rootId: string): Promise<Manifest> {
  const dir = await trashDirFor(rootId);
  try {
    return JSON.parse(await fs.readFile(path.join(dir, MANIFEST_FILE), "utf8"));
  } catch {
    return {};
  }
}

async function writeManifest(rootId: string, manifest: Manifest): Promise<void> {
  const dir = await trashDirFor(rootId);
  await fs.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");
}

export async function softDelete(rootId: string, relativePath: string): Promise<void> {
  const fullPath = resolvePath(rootId, relativePath);
  if (fullPath === getRoot(rootId).path) throw new Error("cannot delete the root directory itself");

  const stat = await fs.stat(fullPath);
  const trashDir = await trashDirFor(rootId);
  const id = crypto.randomBytes(8).toString("hex");
  const trashedPath = path.join(trashDir, id);

  await fs.rename(fullPath, trashedPath);

  const manifest = await readManifest(rootId);
  manifest[id] = {
    name: path.basename(fullPath),
    originalPath: relativePath.startsWith("/") ? relativePath : `/${relativePath}`,
    isDirectory: stat.isDirectory(),
    deletedAt: new Date().toISOString(),
  };
  await writeManifest(rootId, manifest);
}

export async function listTrash(rootId: string): Promise<TrashEntry[]> {
  const manifest = await readManifest(rootId);
  const trashDir = await trashDirFor(rootId);

  const results = await Promise.all(
    Object.entries(manifest).map(async ([id, meta]): Promise<TrashEntry | null> => {
      const stat = await fs.stat(path.join(trashDir, id)).catch(() => null);
      if (!stat) return null;
      return { id, name: meta.name, originalPath: meta.originalPath, isDirectory: meta.isDirectory, size: stat.size, deletedAt: meta.deletedAt };
    })
  );

  return results.filter((r): r is TrashEntry => r !== null).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function restoreFromTrash(rootId: string, id: string): Promise<void> {
  const manifest = await readManifest(rootId);
  const meta = manifest[id];
  if (!meta) throw new Error("trash entry not found");

  const trashDir = await trashDirFor(rootId);
  const trashedPath = path.join(trashDir, id);
  const destPath = resolvePath(rootId, meta.originalPath);

  if (fsSync.existsSync(destPath)) throw new Error("a file or folder already exists at the original location");
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.rename(trashedPath, destPath);

  delete manifest[id];
  await writeManifest(rootId, manifest);
}

export async function deleteFromTrashPermanently(rootId: string, id: string): Promise<void> {
  const manifest = await readManifest(rootId);
  if (!manifest[id]) throw new Error("trash entry not found");

  const trashDir = await trashDirFor(rootId);
  await fs.rm(path.join(trashDir, id), { recursive: true, force: true });
  delete manifest[id];
  await writeManifest(rootId, manifest);
}

export async function emptyTrash(rootId: string): Promise<void> {
  const trashDir = await trashDirFor(rootId);
  await fs.rm(trashDir, { recursive: true, force: true });
  await fs.mkdir(trashDir, { recursive: true });
}

// --- Compress / extract (tar.gz - no extra dependency, always present) -

export async function compressEntries(rootId: string, dirRelative: string, names: string[], archiveName: string): Promise<void> {
  if (names.length === 0) throw new Error("nothing selected to compress");
  names.forEach((n) => assertSimpleName(n, "entry name"));
  if (!/^[a-zA-Z0-9._-]+\.(tar\.gz|tgz)$/.test(archiveName)) throw new Error("archive name must end in .tar.gz");

  const dir = resolvePath(rootId, dirRelative);
  const archivePath = path.join(dir, archiveName);
  await execFileAsync("tar", ["-czf", archivePath, "-C", dir, ...names]);
}

async function assertArchiveSafe(archivePath: string) {
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath]);
  for (const line of stdout.split("\n")) {
    const entry = line.trim();
    if (!entry) continue;
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error(`archive contains an unsafe path: "${entry}"`);
    }
  }
}

export async function extractArchive(rootId: string, relativePath: string): Promise<void> {
  const fullPath = resolvePath(rootId, relativePath);
  if (!/\.(tar\.gz|tgz|tar)$/.test(fullPath)) throw new Error("only .tar.gz/.tgz/.tar archives are supported");

  await assertArchiveSafe(fullPath);

  const dir = path.dirname(fullPath);
  const gzFlag = /\.(tar\.gz|tgz)$/.test(fullPath) ? "z" : "";
  await execFileAsync("tar", [`-x${gzFlag}f`, fullPath, "-C", dir]);
}
