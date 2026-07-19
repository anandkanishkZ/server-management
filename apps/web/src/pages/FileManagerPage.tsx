import { useEffect, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { getAccessToken } from "../lib/authStore";
import "./FileManagerPage.css";

interface FileRoot {
  id: string;
  label: string;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  mode: string;
  type: string;
}

interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  isDirectory: boolean;
  size: number;
  deletedAt: string;
}

function joinPath(base: string, seg: string): string {
  return base === "/" ? `/${seg}` : `${base}/${seg}`;
}

function parentOf(p: string): string {
  if (p === "/") return "/";
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function isArchive(name: string): boolean {
  return /\.(tar\.gz|tgz|tar)$/.test(name);
}

function icon(children: React.ReactNode) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const IconNewFile = () => icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M12 12v6M9 15h6" /></>);
const IconNewFolder = () => icon(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 12v4M10 14h4" /></>);
const IconCopy = () => icon(<><rect x="9" y="9" width="12" height="12" rx="1.5" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
const IconMove = () => icon(<><path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20" /></>);
const IconUpload = () => icon(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>);
const IconDownload = () => icon(<><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>);
const IconDelete = () => icon(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /></>);
const IconRename = () => icon(<><path d="m16.5 4.5 3 3L8 19l-4 1 1-4Z" /></>);
const IconChmod = () => icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
const IconCompress = () => icon(<><path d="M21 8a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2Z" /><path d="M12 10v2M12 14v2" /></>);
const IconTrash = () => icon(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /></>);
const IconReload = () => icon(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>);

interface TreeNodeProps {
  rootId: string;
  nodePath: string;
  label: string;
  depth: number;
  activePath: string;
  onNavigate: (p: string) => void;
  refreshToken: number;
}

function TreeNode({ rootId, nodePath, label, depth, activePath, onNavigate, refreshToken }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchChildren() {
    setLoading(true);
    try {
      const data = await apiFetch(`/files/list?root=${rootId}&path=${encodeURIComponent(nodePath)}`);
      setChildren(data.entries.filter((e: DirEntry) => e.isDirectory));
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (expanded) fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  async function toggle() {
    if (!expanded && children === null) await fetchChildren();
    setExpanded((v) => !v);
  }

  return (
    <div>
      <div className={`tree-node-row ${activePath === nodePath ? "active" : ""}`} style={{ paddingLeft: 10 + depth * 14 }}>
        <span className="tree-toggle" onClick={toggle}>
          {loading ? "…" : expanded ? "▾" : "▸"}
        </span>
        <span onClick={() => onNavigate(nodePath)}>📁 {label}</span>
      </div>
      {expanded &&
        children?.map((c) => (
          <TreeNode
            key={c.name}
            rootId={rootId}
            nodePath={joinPath(nodePath, c.name)}
            label={c.name}
            depth={depth + 1}
            activePath={activePath}
            onNavigate={onNavigate}
            refreshToken={refreshToken}
          />
        ))}
    </div>
  );
}

export default function FileManagerPage() {
  const [roots, setRoots] = useState<FileRoot[] | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [history, setHistory] = useState<string[]>(["/"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [treeVersion, setTreeVersion] = useState(0);

  const [editingFile, setEditingFile] = useState<{ path: string } | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [viewingTrash, setViewingTrash] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch("/files/roots")
      .then((data) => {
        setRoots(data.roots);
        if (data.roots.length > 0) setRootId(data.roots[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load file roots"));
  }, []);

  async function loadDir(root: string, p: string) {
    setError(null);
    setSelected(new Set());
    try {
      const data = await apiFetch(`/files/list?root=${root}&path=${encodeURIComponent(p)}`);
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list directory");
    }
  }

  useEffect(() => {
    if (!rootId) return;
    setCurrentPath("/");
    setHistory(["/"]);
    setHistoryIndex(0);
    setEditingFile(null);
    setViewingTrash(false);
    loadDir(rootId, "/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId]);

  function navigateTo(p: string) {
    if (!rootId) return;
    const truncated = history.slice(0, historyIndex + 1);
    const next = [...truncated, p];
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setCurrentPath(p);
    setEditingFile(null);
    setViewingTrash(false);
    loadDir(rootId, p);
  }

  function goBack() {
    if (historyIndex === 0 || !rootId) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setCurrentPath(history[idx]);
    setEditingFile(null);
    loadDir(rootId, history[idx]);
  }

  function goForward() {
    if (historyIndex >= history.length - 1 || !rootId) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setCurrentPath(history[idx]);
    setEditingFile(null);
    loadDir(rootId, history[idx]);
  }

  function reload() {
    if (!rootId) return;
    if (viewingTrash) loadTrash();
    else loadDir(rootId, currentPath);
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set((entries ?? []).map((e) => e.name)));
  }

  async function openFile(entry: DirEntry) {
    if (!rootId) return;
    const filePath = joinPath(currentPath, entry.name);
    setError(null);
    try {
      const data = await apiFetch(`/files/content?root=${rootId}&path=${encodeURIComponent(filePath)}`);
      if (data.truncated) {
        setError(`"${entry.name}" is too large to edit inline - use Download instead.`);
        return;
      }
      setEditingFile({ path: filePath });
      setEditedContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open file");
    }
  }

  async function saveFile() {
    if (!rootId || !editingFile) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/files/content?root=${rootId}&path=${encodeURIComponent(editingFile.path)}`, {
        method: "PUT",
        body: JSON.stringify({ content: editedContent }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }

  function bumpTree() {
    setTreeVersion((v) => v + 1);
  }

  async function handleNewFile() {
    if (!rootId) return;
    const name = window.prompt("New file name:");
    if (!name) return;
    setError(null);
    try {
      await apiFetch("/files/create", { method: "POST", body: JSON.stringify({ root: rootId, path: currentPath, name }) });
      await loadDir(rootId, currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    }
  }

  async function handleNewFolder() {
    if (!rootId) return;
    const name = window.prompt("New folder name:");
    if (!name) return;
    setError(null);
    try {
      await apiFetch("/files/mkdir", { method: "POST", body: JSON.stringify({ root: rootId, path: currentPath, name }) });
      await loadDir(rootId, currentPath);
      bumpTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!rootId || !files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      try {
        const token = getAccessToken();
        const res = await fetch(`/api/files/upload?root=${rootId}&path=${encodeURIComponent(currentPath)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Upload failed");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
      }
    }
    await loadDir(rootId, currentPath);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDownload() {
    if (!rootId || selected.size !== 1) return;
    const name = [...selected][0];
    const filePath = joinPath(currentPath, name);
    const token = getAccessToken();
    try {
      const res = await fetch(`/api/files/download?root=${rootId}&path=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function handleDeleteSelected() {
    if (!rootId || selected.size === 0) return;
    if (!window.confirm(`Move ${selected.size} item(s) to trash?`)) return;
    setError(null);
    for (const name of selected) {
      try {
        await apiFetch("/files/entry", { method: "DELETE", body: JSON.stringify({ root: rootId, path: joinPath(currentPath, name) }) });
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to delete ${name}`);
      }
    }
    await loadDir(rootId, currentPath);
    bumpTree();
  }

  async function handleRenameSelected() {
    if (!rootId || selected.size !== 1) return;
    const name = [...selected][0];
    const newName = window.prompt(`Rename "${name}" to:`, name);
    if (!newName || newName === name) return;
    setError(null);
    try {
      await apiFetch("/files/rename", { method: "POST", body: JSON.stringify({ root: rootId, path: joinPath(currentPath, name), newName }) });
      await loadDir(rootId, currentPath);
      bumpTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
  }

  async function handleChmodSelected() {
    if (!rootId || selected.size !== 1) return;
    const name = [...selected][0];
    const entry = entries?.find((e) => e.name === name);
    const mode = window.prompt(`Permissions for "${name}" (octal, e.g. 755):`, entry?.mode ?? "644");
    if (!mode) return;
    setError(null);
    try {
      await apiFetch("/files/chmod", { method: "POST", body: JSON.stringify({ root: rootId, path: joinPath(currentPath, name), mode }) });
      await loadDir(rootId, currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change permissions");
    }
  }

  async function handleCopyOrMove(mode: "copy" | "move") {
    if (!rootId || selected.size === 0) return;
    const destFolder = window.prompt(`${mode === "copy" ? "Copy" : "Move"} ${selected.size} item(s) to which folder? (path from root)`, currentPath);
    if (!destFolder) return;

    setError(null);
    for (const name of selected) {
      const destPath = joinPath(destFolder, name);
      try {
        await apiFetch(`/files/${mode}`, { method: "POST", body: JSON.stringify({ root: rootId, path: joinPath(currentPath, name), destPath }) });
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${mode} ${name}`);
      }
    }
    await loadDir(rootId, currentPath);
    bumpTree();
  }

  async function handleCompressSelected() {
    if (!rootId || selected.size === 0) return;
    const archiveName = window.prompt("Archive file name:", "archive.tar.gz");
    if (!archiveName) return;
    setError(null);
    try {
      await apiFetch("/files/compress", {
        method: "POST",
        body: JSON.stringify({ root: rootId, path: currentPath, names: [...selected], archiveName }),
      });
      await loadDir(rootId, currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compress");
    }
  }

  async function handleExtractSelected() {
    if (!rootId || selected.size !== 1) return;
    const name = [...selected][0];
    if (!isArchive(name)) return;
    setError(null);
    try {
      await apiFetch("/files/extract", { method: "POST", body: JSON.stringify({ root: rootId, path: joinPath(currentPath, name) }) });
      await loadDir(rootId, currentPath);
      bumpTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract");
    }
  }

  async function loadTrash() {
    if (!rootId) return;
    setError(null);
    try {
      const data = await apiFetch(`/files/trash?root=${rootId}`);
      setTrashEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trash");
    }
  }

  function openTrash() {
    setViewingTrash(true);
    setEditingFile(null);
    loadTrash();
  }

  async function handleRestore(id: string) {
    if (!rootId) return;
    setError(null);
    try {
      await apiFetch("/files/trash/restore", { method: "POST", body: JSON.stringify({ root: rootId, id }) });
      await loadTrash();
      bumpTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore");
    }
  }

  async function handlePermanentDelete(id: string) {
    if (!rootId) return;
    if (!window.confirm("Permanently delete this item? This cannot be undone.")) return;
    setError(null);
    try {
      await apiFetch(`/files/trash/${id}?root=${rootId}`, { method: "DELETE" });
      await loadTrash();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleEmptyTrash() {
    if (!rootId) return;
    if (!window.confirm("Permanently delete everything in the trash? This cannot be undone.")) return;
    setError(null);
    try {
      await apiFetch("/files/trash/empty", { method: "POST", body: JSON.stringify({ root: rootId }) });
      await loadTrash();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to empty trash");
    }
  }

  const breadcrumbSegments = currentPath === "/" ? [] : currentPath.split("/").filter(Boolean);
  const visibleEntries = (entries ?? []).filter((e) => e.name.toLowerCase().includes(filterText.toLowerCase()));
  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedEntry = selectedName ? entries?.find((e) => e.name === selectedName) : null;

  return (
    <AppShell title="File Manager">
      {error && <div className="error-toast">{error}</div>}

      {editingFile ? (
        <div className="editor-panel">
          <div className="editor-header">
            <span>{editingFile.path}</span>
            <div className="fm-actions">
              <button className="btn" onClick={() => setEditingFile(null)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={saveFile} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <textarea className="editor-textarea" value={editedContent} onChange={(e) => setEditedContent(e.target.value)} spellCheck={false} />
        </div>
      ) : (
        <>
          <div className="fm-toolbar">
            <button className="fm-toolbar-btn" onClick={handleNewFile} disabled={viewingTrash}>
              <IconNewFile /> New File
            </button>
            <button className="fm-toolbar-btn" onClick={handleNewFolder} disabled={viewingTrash}>
              <IconNewFolder /> New Folder
            </button>
            <span className="fm-toolbar-sep" />
            <button className="fm-toolbar-btn" onClick={() => handleCopyOrMove("copy")} disabled={viewingTrash || selected.size === 0}>
              <IconCopy /> Copy
            </button>
            <button className="fm-toolbar-btn" onClick={() => handleCopyOrMove("move")} disabled={viewingTrash || selected.size === 0}>
              <IconMove /> Move
            </button>
            <button className="fm-toolbar-btn" onClick={() => fileInputRef.current?.click()} disabled={viewingTrash}>
              <IconUpload /> Upload
            </button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleUpload(e.target.files)} />
            <button className="fm-toolbar-btn" onClick={handleDownload} disabled={viewingTrash || selected.size !== 1 || !!selectedEntry?.isDirectory}>
              <IconDownload /> Download
            </button>
            <button className="fm-toolbar-btn" onClick={handleDeleteSelected} disabled={viewingTrash || selected.size === 0}>
              <IconDelete /> Delete
            </button>
            <span className="fm-toolbar-sep" />
            <button className="fm-toolbar-btn" onClick={handleRenameSelected} disabled={viewingTrash || selected.size !== 1}>
              <IconRename /> Rename
            </button>
            <button className="fm-toolbar-btn" onClick={handleChmodSelected} disabled={viewingTrash || selected.size !== 1}>
              <IconChmod /> Permissions
            </button>
            <button className="fm-toolbar-btn" onClick={handleCompressSelected} disabled={viewingTrash || selected.size === 0}>
              <IconCompress /> Compress
            </button>
            <button
              className="fm-toolbar-btn"
              onClick={handleExtractSelected}
              disabled={viewingTrash || selected.size !== 1 || !selectedEntry || !isArchive(selectedEntry.name)}
            >
              <IconCompress /> Extract
            </button>
            <span className="fm-toolbar-sep" />
            <button className="fm-toolbar-btn" onClick={reload}>
              <IconReload /> Reload
            </button>
            <button className="fm-toolbar-btn" onClick={selectAll} disabled={viewingTrash}>
              Select All
            </button>
            <button className="fm-toolbar-btn" onClick={() => setSelected(new Set())} disabled={viewingTrash}>
              Unselect All
            </button>
            <span className="fm-toolbar-sep" />
            {viewingTrash ? (
              <>
                <button className="fm-toolbar-btn" onClick={() => navigateTo(currentPath)}>
                  ← Back to Files
                </button>
                <button className="fm-toolbar-btn" onClick={handleEmptyTrash}>
                  <IconTrash /> Empty Trash
                </button>
              </>
            ) : (
              <button className="fm-toolbar-btn" onClick={openTrash}>
                <IconTrash /> View Trash
              </button>
            )}
          </div>

          {!viewingTrash && (
            <div className="fm-navbar">
              <button className="fm-nav-btn" onClick={() => navigateTo("/")}>
                Home
              </button>
              <button className="fm-nav-btn" onClick={() => navigateTo(parentOf(currentPath))} disabled={currentPath === "/"}>
                Up
              </button>
              <button className="fm-nav-btn" onClick={goBack} disabled={historyIndex === 0}>
                Back
              </button>
              <button className="fm-nav-btn" onClick={goForward} disabled={historyIndex >= history.length - 1}>
                Forward
              </button>
              <div className="breadcrumbs">
                <button className="breadcrumb-item" onClick={() => navigateTo("/")}>
                  {roots?.find((r) => r.id === rootId)?.label ?? "root"}
                </button>
                {breadcrumbSegments.map((seg, i) => {
                  const segPath = `/${breadcrumbSegments.slice(0, i + 1).join("/")}`;
                  return (
                    <span key={segPath}>
                      <span className="breadcrumb-sep">/</span>
                      <button className="breadcrumb-item" onClick={() => navigateTo(segPath)}>
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </div>
              <input className="fm-search" placeholder="Search this folder…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
            </div>
          )}

          <div className="fm-body">
            {!viewingTrash && rootId && (
              <div className="fm-tree">
                <TreeNode
                  rootId={rootId}
                  nodePath="/"
                  label={roots?.find((r) => r.id === rootId)?.label ?? "root"}
                  depth={0}
                  activePath={currentPath}
                  onNavigate={navigateTo}
                  refreshToken={treeVersion}
                />
              </div>
            )}

            <div className="fm-main">
              {viewingTrash ? (
                !trashEntries ? (
                  <p>Loading…</p>
                ) : trashEntries.length === 0 ? (
                  <div className="empty-state-fm">Trash is empty.</div>
                ) : (
                  <table className="fm-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Original location</th>
                        <th>Size</th>
                        <th>Deleted</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {trashEntries.map((t) => (
                        <tr key={t.id}>
                          <td>
                            {t.isDirectory ? "📁" : "📄"} {t.name}
                          </td>
                          <td className="fm-meta">{t.originalPath}</td>
                          <td className="fm-meta">{fmtSize(t.size)}</td>
                          <td className="fm-meta">{new Date(t.deletedAt).toLocaleString()}</td>
                          <td>
                            <div className="fm-row-actions">
                              <button className="unban-btn" onClick={() => handleRestore(t.id)}>
                                Restore
                              </button>
                              <button className="unban-btn" onClick={() => handlePermanentDelete(t.id)}>
                                Delete forever
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : !entries ? (
                <p>Loading…</p>
              ) : visibleEntries.length === 0 ? (
                <div className="empty-state-fm">{entries.length === 0 ? "This folder is empty." : "No files match your search."}</div>
              ) : (
                <table className="fm-table">
                  <thead>
                    <tr>
                      <th>
                        <input type="checkbox" checked={selected.size > 0 && selected.size === visibleEntries.length} onChange={(e) => (e.target.checked ? selectAll() : setSelected(new Set()))} />
                      </th>
                      <th>Name</th>
                      <th>Size</th>
                      <th>Modified</th>
                      <th>Type</th>
                      <th>Permissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((entry) => (
                      <tr key={entry.name} className={selected.has(entry.name) ? "selected-row" : ""}>
                        <td>
                          <input type="checkbox" checked={selected.has(entry.name)} onChange={() => toggleSelect(entry.name)} />
                        </td>
                        <td>
                          <div
                            className={`fm-name-cell ${entry.isDirectory ? "" : "file-name"}`}
                            onClick={() => (entry.isDirectory ? navigateTo(joinPath(currentPath, entry.name)) : openFile(entry))}
                          >
                            {entry.isDirectory ? "📁" : "📄"} {entry.name}
                          </div>
                        </td>
                        <td className="fm-meta">{entry.isDirectory ? "—" : fmtSize(entry.size)}</td>
                        <td className="fm-meta">{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : "—"}</td>
                        <td className="fm-meta">{entry.type}</td>
                        <td className="fm-meta">{entry.mode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
