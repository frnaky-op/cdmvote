import { PlayerForm } from "../player-form";

export default function NewPlayerPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">New player</h1>
      <PlayerForm />
    </div>
  );
}
