import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";
import { ProjectSelector } from "./components/ProjectSelector";
import { ChatPage } from "./components/ChatPage";
import { Login } from "./components/Login";
import { RequireAuth } from "./components/RequireAuth";
import { SettingsProvider } from "./contexts/SettingsContext";
import { AuthProvider } from "./contexts/AuthContext";
import { isDevelopment } from "./utils/environment";

// Lazy load DemoPage only in development
const DemoPage = isDevelopment()
  ? lazy(() =>
      import("./components/DemoPage").then((module) => ({
        default: module.DemoPage,
      })),
    )
  : null;

function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <ProjectSelector />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/*"
              element={
                <RequireAuth>
                  <ChatPage />
                </RequireAuth>
              }
            />
            {DemoPage && (
              <Route
                path="/demo"
                element={
                  <Suspense fallback={<div>Loading demo...</div>}>
                    <DemoPage />
                  </Suspense>
                }
              />
            )}
          </Routes>
        </Router>
      </AuthProvider>
    </SettingsProvider>
  );
}

export default App;
