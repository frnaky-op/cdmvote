"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Player = {
  id: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
};

export function PlayerForm({
  player,
  canDelete,
}: {
  player?: Player;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(player?.name ?? "");
  const [bio, setBio] = useState(player?.bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const url = player ? `/api/players/${player.id}` : "/api/players";
    const method = player ? "PATCH" : "POST";

    const response = await fetch(url, { method, body: formData });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Something went wrong");
      setSubmitting(false);
      return;
    }

    router.push("/players");
    router.refresh();
  }

  async function handleDelete() {
    if (!player) return;
    setError(null);
    setDeleting(true);

    const response = await fetch(`/api/players/${player.id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Could not delete player");
      setDeleting(false);
      return;
    }

    router.push("/players");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm text-zinc-700 dark:text-zinc-300">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="bio" className="text-sm text-zinc-700 dark:text-zinc-300">
          Bio (optional)
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="photo" className="text-sm text-zinc-700 dark:text-zinc-300">
          Photo {player?.photoUrl ? "(replace)" : "(optional)"}
        </label>
        <input
          id="photo"
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="w-full text-sm text-zinc-700 dark:text-zinc-300"
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-between pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {submitting ? "Saving…" : "Save"}
        </button>

        {player && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            title={canDelete ? undefined : "Can't delete a player already assigned to a match"}
            className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:text-red-400"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </form>
  );
}
