export interface CertInfo {
  name: string;
  domains: string[];
  expiryDate: string | null;
  daysRemaining: number | null;
  valid: boolean;
  certPath: string | null;
}

// Parses `certbot certificates` output, e.g.:
//   Certificate Name: example.com
//     Domains: example.com www.example.com
//     Expiry Date: 2026-10-17 09:27:27+00:00 (VALID: 89 days)
//     Certificate Path: /etc/letsencrypt/live/example.com/fullchain.pem
export function parseCertbotCertificates(output: string): CertInfo[] {
  const blocks = output.split(/(?=^\s*Certificate Name:)/m).filter((b) => /Certificate Name:/.test(b));

  return blocks.map((block): CertInfo => {
    const name = block.match(/Certificate Name:\s*(.+)/)?.[1]?.trim() ?? "unknown";
    const domainsLine = block.match(/Domains:\s*(.+)/)?.[1]?.trim() ?? "";
    const domains = domainsLine.split(/\s+/).filter(Boolean);

    const expiryMatch = block.match(/Expiry Date:\s*(.+?)\s*\((VALID|INVALID)(?::\s*(\d+)\s*days?)?\)/);
    const expiryDate = expiryMatch?.[1] ?? null;
    const valid = expiryMatch?.[2] === "VALID";
    const daysRemaining = expiryMatch?.[3] ? Number(expiryMatch[3]) : null;

    const certPath = block.match(/Certificate Path:\s*(.+)/)?.[1]?.trim() ?? null;

    return { name, domains, expiryDate, daysRemaining, valid, certPath };
  });
}
