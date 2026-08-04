"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResetTournamentButton() {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    const confirmed = window.confirm(
      "This permanently deletes ALL players, matches, and votes. This cannot be undone. Continue?",
    );
    if (!confirmed) return;

    setResetting(true);
    setError(null);

    const response = await fetch("/api/admin/reset", { method: "POST" });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Reset failed");
      setResetting(false);
      return;
    }

    router.refresh();
    setResetting(false);
  }

  return (
    <div className="mt-10 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
      <p className="mb-1 text-sm font-medium text-red-900 dark:text-red-200">Danger zone</p>
      <p className="mb-3 text-sm text-red-700 dark:text-red-300">
        Permanently deletes all players, matches, and votes. Use this to reset before a
        rehearsal or after testing.
      </p>
      {error && <p className="mb-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <button
        onClick={handleReset}
        disabled={resetting}
        className="rounded border border-red-600 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-400 dark:text-red-400"
      >
        {resetting ? "Resetting…" : "Reset tournament data"}
      </button>
    </div>
  );
}
