import { useCallback } from "react";
import { getAbortUrl } from "../../config/api";
import { authFetch } from "../../utils/authFetch";

export function useAbortController() {
  // Helper function to perform abort request
  const performAbortRequest = useCallback(async (requestId: string) => {
    await authFetch(getAbortUrl(requestId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  }, []);

  const abortRequest = useCallback(
    async (
      requestId: string | null,
      isLoading: boolean,
      onAbortComplete: () => void,
    ) => {
      if (!requestId || !isLoading) return;

      try {
        await performAbortRequest(requestId);
      } catch (error) {
        console.error("Failed to abort request:", error);
      } finally {
        // Clean up state after successful abort or error
        onAbortComplete();
      }
    },
    [performAbortRequest],
  );

  const createAbortHandler = useCallback(
    (requestId: string) => async () => {
      try {
        await performAbortRequest(requestId);
      } catch (error) {
        console.error("Failed to abort request:", error);
      }
    },
    [performAbortRequest],
  );

  return {
    abortRequest,
    createAbortHandler,
  };
}
