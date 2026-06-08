import { ChevronsUpDown, Plus, Settings } from "lucide-react";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { toCompanyRelativePath } from "../lib/company-routes";
import { useCompany } from "../context/CompanyContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState } from "react";

function statusDotColor(status?: string): string {
  switch (status) {
    case "active":
      return "bg-green-400";
    case "paused":
      return "bg-yellow-400";
    case "archived":
      return "bg-neutral-400";
    default:
      return "bg-green-400";
  }
}

interface CompanySwitcherProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CompanySwitcher({ open: controlledOpen, onOpenChange }: CompanySwitcherProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { companies, selectedCompany, setSelectedCompanyId } = useCompany();
  const sidebarCompanies = companies.filter((company) => company.status !== "archived");
  const archivedCompanies = companies.filter((company) => company.status === "archived");
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  function openCompany(company: { id: string; issuePrefix: string }) {
    setSelectedCompanyId(company.id);
    const currentRelativePath = toCompanyRelativePath(`${location.pathname}${location.search}${location.hash}`);
    const nextRelativePath = currentRelativePath === "/companies" ? "/dashboard" : currentRelativePath;
    navigate(`/${company.issuePrefix}${nextRelativePath}`);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-2 py-1.5 h-auto text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {selectedCompany && (
              <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotColor(selectedCompany.status)}`} />
            )}
            <span className="text-sm font-medium truncate">
              {selectedCompany?.name ?? "Select company"}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        <DropdownMenuLabel>Companies</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sidebarCompanies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => openCompany(company)}
            className={company.id === selectedCompany?.id ? "bg-accent" : ""}
          >
            <span className={`h-2 w-2 rounded-full shrink-0 mr-2 ${statusDotColor(company.status)}`} />
            <span className="truncate">{company.name}</span>
          </DropdownMenuItem>
        ))}
        {sidebarCompanies.length === 0 && archivedCompanies.length === 0 && (
          <DropdownMenuItem disabled>No companies</DropdownMenuItem>
        )}
        {archivedCompanies.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Archived · read-only</DropdownMenuLabel>
            {archivedCompanies.map((company) => (
              <DropdownMenuItem
                key={company.id}
                onClick={() => openCompany(company)}
                className={company.id === selectedCompany?.id ? "bg-accent" : ""}
              >
                <span className={`h-2 w-2 rounded-full shrink-0 mr-2 ${statusDotColor(company.status)}`} />
                <span className="truncate">{company.name}</span>
                <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {company.issuePrefix}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/company/settings" className="no-underline text-inherit">
            <Settings className="h-4 w-4 mr-2" />
            Company Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/companies" className="no-underline text-inherit">
            <Plus className="h-4 w-4 mr-2" />
            Manage Companies
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
