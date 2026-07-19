interface LogoProps {
  size?: number;
}

export default function Logo({ size = 36 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" role="img" aria-label="Server Panel">
      <rect width="36" height="36" rx="10" fill="url(#logo-gradient)" />
      <path
        d="M10 13.5C10 12.1193 11.1193 11 12.5 11H23.5C24.8807 11 26 12.1193 26 13.5V14.5C26 15.8807 24.8807 17 23.5 17H12.5C11.1193 17 10 15.8807 10 14.5V13.5Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M10 21.5C10 20.1193 11.1193 19 12.5 19H23.5C24.8807 19 26 20.1193 26 21.5V22.5C26 23.8807 24.8807 25 23.5 25H12.5C11.1193 25 10 23.8807 10 22.5V21.5Z"
        fill="white"
        fillOpacity="0.65"
      />
      <circle cx="13" cy="14" r="1.1" fill="#0a66c2" />
      <circle cx="13" cy="22" r="1.1" fill="#0a66c2" />
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0a66c2" />
          <stop offset="1" stopColor="#004182" />
        </linearGradient>
      </defs>
    </svg>
  );
}
