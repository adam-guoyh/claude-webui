import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProjectSelector } from "./components/ProjectSelector";
import { ChatPage } from "./components/ChatPage";
import { SettingsProvider } from "./contexts/SettingsContext";
import { AuthProvider } from "./contexts/AuthContext";

// Mock fetch globally
global.fetch = vi.fn();

describe("App Routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock projects API response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    });
  });

  it("renders project selection page at root path", async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<ProjectSelector />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Select a Project")).toBeInTheDocument();
    });
  });

  it("renders chat page when navigating to projects path", async () => {
    await act(async () => {
      render(
        <SettingsProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/projects/test-path"]}>
              <Routes>
                <Route path="/projects/*" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </SettingsProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Claude Code Web UI")).toBeInTheDocument();
      // The project path now appears both in the breadcrumb and the
      // ProjectSwitcher pill above the session list — accept any number.
      expect(screen.getAllByText("/test-path").length).toBeGreaterThan(0);
    });
  });
});
