import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SitesPage from "./pages/SitesPage";
import LogsPage from "./pages/LogsPage";
import SecurityPage from "./pages/SecurityPage";
import DatabasesPage from "./pages/DatabasesPage";
import DatabaseBrowserPage from "./pages/DatabaseBrowserPage";
import FileManagerPage from "./pages/FileManagerPage";
import DomainsPage from "./pages/DomainsPage";
import { useAuthStore, setInitializing } from "./lib/authStore";
import { refreshSession } from "./lib/api";
import "./styles/theme.css";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function FullScreenSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div className="skeleton-spinner" />
    </div>
  );
}

function App() {
  const initializing = useAuthStore((s) => s.initializing);

  useEffect(() => {
    // A page refresh clears all in-memory state, but a valid httpOnly
    // refresh cookie may still exist - try to silently exchange it for a
    // new access token before deciding whether to bounce to /login.
    refreshSession().finally(() => setInitializing(false));
  }, []);

  if (initializing) return <FullScreenSpinner />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/sites"
          element={
            <RequireAuth>
              <SitesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/logs"
          element={
            <RequireAuth>
              <LogsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/security"
          element={
            <RequireAuth>
              <SecurityPage />
            </RequireAuth>
          }
        />
        <Route
          path="/databases"
          element={
            <RequireAuth>
              <DatabasesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/databases/:name"
          element={
            <RequireAuth>
              <DatabaseBrowserPage />
            </RequireAuth>
          }
        />
        <Route
          path="/files"
          element={
            <RequireAuth>
              <FileManagerPage />
            </RequireAuth>
          }
        />
        <Route
          path="/domains"
          element={
            <RequireAuth>
              <DomainsPage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
