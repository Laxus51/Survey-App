import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { PublicOnlyRoute } from "./auth/PublicOnlyRoute";
import { useSyncEngineLifecycle } from "./hooks/useSyncEngineLifecycle";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NewSurveyPage } from "./pages/NewSurveyPage";
import { SurveyDetailsPage } from "./pages/SurveyDetailsPage";
import "./App.css";

// Renders nothing - just gives the sync engine's app-start/online-event
// triggers a place to live inside AuthProvider (useSyncEngineLifecycle
// needs useAuth(), which only works below AuthProvider in the tree).
function SyncEngineLifecycle() {
  useSyncEngineLifecycle();
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SyncEngineLifecycle />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/surveys/new"
            element={
              <ProtectedRoute>
                <NewSurveyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/surveys/:id"
            element={
              <ProtectedRoute>
                <SurveyDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
