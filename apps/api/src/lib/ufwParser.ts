export interface UfwRule {
  number: number;
  action: string;
  target: string;
  from: string;
}

export interface UfwStatus {
  enabled: boolean;
  rules: UfwRule[];
}

// Parses the output of `ufw status numbered`, e.g.:
//   Status: active
//
//      To                         Action      From
//      --                         ------      ----
//   [ 1] 22/tcp                    ALLOW IN    Anywhere
//   [ 2] 80,443/tcp                ALLOW IN    Anywhere
export function parseUfwStatus(output: string): UfwStatus {
  const enabled = /^Status:\s*active/m.test(output);
  const rules: UfwRule[] = [];

  const lineRe = /^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/gm;
  for (const m of output.matchAll(lineRe)) {
    const [, num, target, action, from] = m;
    rules.push({ number: Number(num), target: target.trim(), action: action.trim(), from: from.trim() });
  }

  return { enabled, rules };
}
