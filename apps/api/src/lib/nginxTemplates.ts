export interface StaticSiteInput {
  domain: string;
  aliasDomains: string[];
  root: string;
}

export interface ProxySiteInput {
  domain: string;
  aliasDomains: string[];
  port: number;
}

function serverNames(domain: string, aliases: string[]): string {
  return [domain, ...aliases].join(" ");
}

// Deliberately plain HTTP (port 80) only - this is the starting point
// certbot's --nginx plugin edits in place to add the 443/SSL block, the
// same way the existing hand-configured sites on this box are set up.
export function staticSiteConfig({ domain, aliasDomains, root }: StaticSiteInput): string {
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames(domain, aliasDomains)};

    root ${root};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
}

export function proxySiteConfig({ domain, aliasDomains, port }: ProxySiteInput): string {
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames(domain, aliasDomains)};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}
