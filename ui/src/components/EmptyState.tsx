import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  action?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, message, action, onAction }: EmptyStateProps) {
  const { t } = useTranslation();
  const resolvedMessage = typeof message === "string" && message.includes(".") ? t(message) : message;
  const resolvedAction = typeof action === "string" && action.includes(".") ? t(action) : action;
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted/50 p-4 mb-4">
        <Icon className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground mb-4">{resolvedMessage}</p>
      {resolvedAction && onAction && (
        <Button onClick={onAction}>
          <Plus className="h-4 w-4 mr-1.5" />
          {resolvedAction}
        </Button>
      )}
    </div>
  );
}
