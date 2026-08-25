import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../services/httpClient";
import { StorageUnavailableError } from "../services/tokenStore";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
        setError("Unable to connect to the server. Please check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    // No card/border here on purpose (per user feedback on the first pass):
    // the form sits directly on the page background, one flat surface, no
    // separate div for "the login section" vs. "the page."
    <div className="flex min-h-svh items-center justify-center overflow-y-auto bg-base-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-base-content">Log in</h1>
          <p className="mt-1 font-semibold text-primary">Login to your account</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm font-medium text-base-content">
              Username
            </label>
            <input
              id="username"
              type="text"
              className="input min-h-11 w-full"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-base-content">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={isPasswordVisible ? "text" : "password"}
                className="input min-h-11 w-full pr-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={isSubmitting}
              />
              {/* type="button" is load-bearing: inside a <form>, a button
                  defaults to type="submit" and would log the surveyor in
                  (or try to) just from tapping the visibility toggle. */}
              <button
                type="button"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                // border-0/bg-transparent/p-0 are explicit, not just relying
                // on Tailwind's own reset: this button sits inside an
                // .input, so the legacy-base `button` rule's border/
                // background/padding (see index.css) must not reappear here
                // even though the cascade-layer fix already makes Tailwind
                // utilities win in general - belt and suspenders, since this
                // was exactly the bug just found.
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center border-0 bg-transparent p-0 text-base-content/60 hover:text-base-content"
                aria-label={isPasswordVisible ? "Hide password" : "Show password"}
              >
                {isPasswordVisible ? (
                  <EyeOff className="size-5" aria-hidden="true" />
                ) : (
                  <Eye className="size-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary min-h-11 w-full" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {isSubmitting ? "Logging in…" : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
