import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../services/httpClient";
import { StorageUnavailableError } from "../services/tokenStore";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      // Distinguishing these matters: a rejected password, an unreachable
      // server, and a browser that won't let us store the session are three
      // different problems with three different fixes, and collapsing them
      // into one generic message leaves the surveyor (and anyone debugging
      // from a field report) with nothing to act on.
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? "Invalid username or password."
            : `The server rejected the sign-in (error ${err.status}). Please try again.`,
        );
      } else if (err instanceof StorageUnavailableError) {
        setError(
          "Signed in, but this browser wouldn't let the app save your session. Check that site data/cookies are allowed for this site, and that you're not in private browsing.",
        );
      } else {
        setError("Couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Survey App</h1>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
