import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../services/httpClient";
import { StorageUnavailableError } from "../services/tokenStore";

const loginMock = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ login: loginMock }),
}));

import { LoginPage } from "./LoginPage";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Dashboard Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillAndSubmit(username = "surveyor1", password = "pw12345") {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));
}

beforeEach(() => {
  loginMock.mockReset();
});

describe("LoginPage", () => {
  it("signs in and navigates to the dashboard on success", async () => {
    loginMock.mockResolvedValue(undefined);
    renderLogin();

    fillAndSubmit();

    expect(await screen.findByText("Dashboard Home")).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledWith("surveyor1", "pw12345");
  });

  // The existing auth logic distinguishes several failure kinds; the whole
  // point of this redesign's error UX is that none of them should read as
  // an interchangeable generic failure, so each gets its own assertion
  // against the *other* messages, not just its own.
  it("shows a specific message for invalid credentials (401), distinct from other failures", async () => {
    loginMock.mockRejectedValue(new ApiError(401, { detail: "no" }));
    renderLogin();

    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid username or password.");
    expect(alert).not.toHaveTextContent(/unable to connect/i);
  });

  it("shows a distinct message for a non-401 server error", async () => {
    loginMock.mockRejectedValue(new ApiError(500, null));
    renderLogin();

    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/error 500/i);
    expect(alert).not.toHaveTextContent("Invalid username or password.");
  });

  it("shows a distinct message when the server is unreachable", async () => {
    loginMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderLogin();

    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unable to connect/i);
    expect(alert).not.toHaveTextContent("Invalid username or password.");
  });

  it("shows a distinct message when the browser can't persist the session", async () => {
    // Not one of the 3 headline cases in the brief, but real, already-tested
    // behavior in AuthContext - dropping it here would be a regression.
    loginMock.mockRejectedValue(new StorageUnavailableError(new Error("blocked")));
    renderLogin();

    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/wouldn't let the app save your session/i);
  });

  it("disables the form during submission and prevents a duplicate submit", async () => {
    let resolveLogin: (() => void) | undefined;
    loginMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    renderLogin();

    fillAndSubmit();

    const submitButton = await screen.findByRole("button", { name: "Logging in…" });
    expect(submitButton).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();

    fireEvent.click(submitButton);
    expect(loginMock).toHaveBeenCalledTimes(1);

    resolveLogin!();
    await screen.findByText("Dashboard Home");
  });

  it("toggles password visibility without losing the typed value or submitting the form", () => {
    renderLogin();
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: "secret-value" } });
    expect(passwordInput.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(passwordInput.type).toBe("text");
    expect(passwordInput.value).toBe("secret-value");
    expect(loginMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(passwordInput.type).toBe("password");
    expect(passwordInput.value).toBe("secret-value");
  });

  it("submits via the form's native submit path (what a real Enter keypress triggers)", async () => {
    loginMock.mockResolvedValue(undefined);
    renderLogin();

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "surveyor1" } });
    const passwordInput = screen.getByLabelText("Password");
    fireEvent.change(passwordInput, { target: { value: "pw12345" } });
    fireEvent.submit(passwordInput.closest("form")!);

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("surveyor1", "pw12345"));
  });

  it("associates each input with its visible label", () => {
    renderLogin();
    expect(screen.getByLabelText("Username")).toHaveAttribute("id", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("id", "password");
  });
});
