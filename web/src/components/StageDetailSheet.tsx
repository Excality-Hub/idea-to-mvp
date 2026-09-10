import { STAGE_STATUS_CONFIG, type StageDisplayStatus } from "@/components/status";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { RunEvent } from "@/types";

interface StageDetailSheetProps {
  label: string | undefined;
  status: StageDisplayStatus;
  events: RunEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function StageDetailSheet({ label, status, events, open, onOpenChange }: StageDetailSheetProps) {
  const config = STAGE_STATUS_CONFIG[status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {label}
            <span className={cn("text-xs font-medium", config.dotClassName)}>{config.label}</span>
          </SheetTitle>
          <SheetDescription>Full event log for this stage, live-updating.</SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="flex-1 px-4">
          {events.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No events yet &mdash; this stage hasn&rsquo;t started.
            </p>
          ) : (
            <ul className="space-y-3 py-4 font-mono text-xs">
              {events.map((event, index) => (
                <li key={`${event.timestamp}-${index}`} className="rounded-lg bg-muted px-3 py-2">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{formatTime(event.timestamp)}</span>
                    <span className={STAGE_STATUS_CONFIG[event.status].dotClassName}>
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-foreground">{event.message}</p>
                  {event.input !== undefined && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Input
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-foreground">
                        {JSON.stringify(event.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {event.output !== undefined && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Output
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-foreground">
                        {JSON.stringify(event.output, null, 2)}
                      </pre>
                    </div>
                  )}
                  {event.usage !== undefined && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Tokens
                      </p>
                      <p className="mt-1 text-foreground">
                        {event.usage.inputTokens.toLocaleString()} in &middot;{" "}
                        {event.usage.outputTokens.toLocaleString()} out &middot;{" "}
                        {event.usage.cacheReadInputTokens.toLocaleString()} cache-read &middot; $
                        {event.usage.costUsd.toFixed(4)}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
