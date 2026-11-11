import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/shared/ui/utils";
import {
  usePreferredAccountIds,
  useSetAccountPreferred,
} from "@/modules/cloud-account/hooks/useCloudAccounts";

/** Star that adds the account to the pool auto-switch tries first. */
export function PreferredAccountToggle({
  accountId,
  className,
}: {
  accountId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: preferredIds = [] } = usePreferredAccountIds();
  const setPreferred = useSetAccountPreferred();
  const isPreferred = preferredIds.includes(accountId);
  const label = isPreferred
    ? t("cloud.card.preferredRemove")
    : t("cloud.card.preferredAdd");

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("hover:bg-muted h-8 w-8 rounded-full", className)}
            aria-label={label}
            aria-pressed={isPreferred}
            disabled={setPreferred.isPending}
            onClick={() =>
              setPreferred.mutate({ accountId, preferred: !isPreferred })
            }
          >
            <Star
              className={cn(
                "h-4 w-4",
                isPreferred
                  ? "fill-amber-400 text-amber-500"
                  : "text-muted-foreground",
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-56 text-xs">
          {label}
          <span className="text-muted-foreground block">
            {t("cloud.card.preferredHint")}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
