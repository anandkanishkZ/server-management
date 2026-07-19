export interface DatabaseInfo {
  name: string;
  owner: string;
  size: string;
}

// Parses `psql -tA -F '\t'` output: one row per line, tab-separated fields.
export function parseDatabaseList(output: string): DatabaseInfo[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, owner, size] = line.split("\t");
      return { name, owner, size };
    });
}
