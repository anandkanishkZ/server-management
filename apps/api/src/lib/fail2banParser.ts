export interface JailSummary {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
  bannedIps: string[];
}

// Parses `fail2ban-client status`, e.g.:
//   Status
//   |- Number of jail:      2
//   `- Jail list:   sshd, nginx-http-auth
export function parseJailList(output: string): string[] {
  const m = output.match(/Jail list:\s*(.*)/);
  if (!m || !m[1].trim()) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractNumber(output: string, label: string): number {
  const m = output.match(new RegExp(`${label}:\\s*(\\d+)`));
  return m ? Number(m[1]) : 0;
}

// Parses `fail2ban-client status <jail>`, e.g.:
//   Status for the jail: sshd
//   |- Filter
//   |  |- Currently failed: 0
//   |  |- Total failed:     12
//   |  `- File list:        /var/log/auth.log
//   `- Actions
//      |- Currently banned:  2
//      |- Total banned:      5
//      `- Banned IP list:    1.2.3.4 5.6.7.8
export function parseJailStatus(name: string, output: string): JailSummary {
  const bannedListMatch = output.match(/Banned IP list:\s*(.*)/);
  const bannedIps = bannedListMatch
    ? bannedListMatch[1]
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    name,
    currentlyFailed: extractNumber(output, "Currently failed"),
    totalFailed: extractNumber(output, "Total failed"),
    currentlyBanned: extractNumber(output, "Currently banned"),
    totalBanned: extractNumber(output, "Total banned"),
    bannedIps,
  };
}
