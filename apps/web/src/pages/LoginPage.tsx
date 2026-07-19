import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { setSession } from "../lib/authStore";
import Logo from "../components/Logo";
import "./LoginPage.css";

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6l-8-3Z" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.4 5.3A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-0.4 1.1-1.2 2.4-2.3 3.6M6.4 6.6C4.3 8 2.9 9.9 2 12c1 2.5 5 7 10 7 1.4 0 2.7-.3 3.9-.8" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, string> = { email, password };
      if (needsTotp) body.totpCode = totpCode;

      const data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(body) });

      if (data.requiresTotp) {
        setNeedsTotp(true);
        return;
      }

      setSession(data.accessToken, data.user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <Logo size={44} />
          <div>
            <h1 className="login-title">Server Panel</h1>
            <p className="login-subtitle">
              {needsTotp ? "Enter the 6-digit code from your authenticator app" : "Sign in to manage your infrastructure"}
            </p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {!needsTotp ? (
            <>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <div className="input-wrap">
                  <MailIcon />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="input-wrap password">
                  <LockIcon />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="toggle-visibility"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <EyeIcon off={showPassword} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="totp">Verification code</label>
              <div className="input-wrap">
                <ShieldIcon />
                <input
                  id="totp"
                  className="totp-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                />
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="submit-button" disabled={loading}>
            {loading && <span className="spinner" />}
            {needsTotp ? "Verify & sign in" : "Sign in"}
          </button>

          {needsTotp && (
            <button
              type="button"
              className="back-link"
              onClick={() => {
                setNeedsTotp(false);
                setTotpCode("");
                setError(null);
              }}
            >
              <ArrowLeftIcon /> Back
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
