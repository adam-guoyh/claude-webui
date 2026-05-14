import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Route guard that only renders children when the caller is signed in *and*
 * has the admin role. Anyone else is bounced back to "/".
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status, role } = useAuth();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  if (role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
