import { useState } from "react";
import { useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { goalsApi } from "../api/goals";
import { Button } from "@/components/ui/button";

export function NewGoal() {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await goalsApi.create(selectedCompanyId, { title: title.trim(), description: description.trim() || null });
      navigate(`/DEMO/goals`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold">New Goal</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium">Title *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
            rows={3}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting || !title.trim()}>
            {submitting ? "Creating…" : "Create goal"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/DEMO/goals`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
