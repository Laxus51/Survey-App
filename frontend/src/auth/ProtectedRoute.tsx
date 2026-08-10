import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { LoadingScreen } from "../components/LoadingScreen";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
