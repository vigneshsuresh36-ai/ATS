"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthBootScreen, useAuth } from "@/components/AuthProvider";
import "../../auth.css";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.3 4 24 4 16.1 4 9.2 8.5 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.1 39.5 16 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l.1.1 6.2 5.2C39.2 37.2 44 32 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const { profile, loading, token, signInGoogle, error } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && token && profile) router.replace("/app");
  }, [loading, token, profile, router]);

  async function onGoogle() {
    setBusy(true);
    setErr(null);
    try {
      await signInGoogle();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  // Don't paint the public login UI while session is restoring / signing in.
  if (loading || busy || (token && profile)) {
    return (
      <AuthBootScreen
        message={busy ? "Signing you in" : token && profile ? "Opening your workspace" : "Getting things ready"}
        detail={
          busy
            ? "Finish Google sign-in if a window is open…"
            : token && profile
              ? "Taking you to LT Recruitment Project…"
              : "Restoring your session…"
        }
      />
    );
  }

  return (
    <div className="lt-auth-shell">
      <div className="lt-auth-inner">
        <nav className="lt-nav">
          <Link href="/" className="lt-brand">
            <span className="lt-mark" role="img" aria-label="VIGNESH Project Z - AI ATS" />
          </Link>
        </nav>

        <div className="lt-login-wrap">
          <div className="lt-login-layout">
            <div className="lt-login-visual" aria-hidden="true">
              <div className="lt-doodle lt-doodle-one" />
              <div className="lt-doodle lt-doodle-two" />
              <div className="lt-art-panel lt-art-panel-main">
                <div className="lt-panel-badge">Recruitment</div>
                <div className="lt-panel-row">
                  <span className="lt-mini-pill teal">Open</span>
                  <span className="lt-mini-pill purple">Talent</span>
                </div>
                <div className="lt-pipeline">
                  <span className="lt-pipe-dot active" />
                  <span className="lt-pipe-dot" />
                  <span className="lt-pipe-dot" />
                  <span className="lt-pipe-dot" />
                </div>
                <div className="lt-people-row">
                  <span className="lt-person">A</span>
                  <span className="lt-person alt">M</span>
                  <span className="lt-person alt-2">S</span>
                  <span className="lt-person soft">+12</span>
                </div>
              </div>
              <div className="lt-art-panel lt-art-panel-side">
                <span className="lt-list-icon">✓</span>
                <div>
                  <strong>Hiring pulse</strong>
                  <small>12 roles active</small>
                </div>
              </div>
              <div className="lt-art-panel lt-art-panel-card">
                <div className="lt-card-line" />
                <div className="lt-card-line short" />
                <div className="lt-card-line short" />
              </div>
            </div>

            <div className="lt-login-panel">
              <h1>Welcome back</h1>
              <p>
                Sign in with your work Google account. Your role comes from the
                team list — Admin, Talent acquisition, Hiring Manager, or Department Head.
              </p>

              {(err || error) && <div className="lt-err">{err || error}</div>}

              <button
                type="button"
                className="lt-btn lt-google"
                disabled={busy || loading}
                onClick={onGoogle}
              >
                <GoogleIcon />
                {busy ? "Opening Google…" : "Continue with Google"}
              </button>

              <p className="lt-foot">
                Don&apos;t have team access yet? Contact your Admin to get added under <strong>Team &amp; Access</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
