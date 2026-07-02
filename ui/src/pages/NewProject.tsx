import { useState } from "react";
import { useNavigate } from "@/lib/router";
import { useTranslation } from "@/i18n";
import { useCompany } from "../context/CompanyContext";
import { projectsApi } from "../api/projects";
import { Button } from "@/components/ui/button";

export function NewProject() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await projectsApi.create(selectedCompanyId, { name: name.trim(), description: description.trim() || null });
      navigate(`/DEMO/projects`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold">New Project</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          <Button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/DEMO/projects`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
