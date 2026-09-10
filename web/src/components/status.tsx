import { CheckCircle2, CircleDashed, CirclePause, Loader2, ShieldAlert, XCircle } from "lucide-react";
import type { OverallStatus } from "@/types";

export type StageDisplayStatus = "pending" | "running" | "done" | "failed" | "blocked" | "stopped";

interface StatusConfig {
  label: string;
  dotClassName: string;
  icon: typeof CheckCircle2;
}

export const STAGE_STATUS_CONFIG: Record<StageDisplayStatus, StatusConfig> = {
  pending: { label: "Not started", dotClassName: "text-muted-foreground", icon: CircleDashed },
  running: { label: "Running", dotClassName: "text-primary", icon: Loader2 },
  done: { label: "Done", dotClassName: "text-success", icon: CheckCircle2 },
  failed: { label: "Failed", dotClassName: "text-destructive", icon: XCircle },
  blocked: { label: "Blocked", dotClassName: "text-warning", icon: ShieldAlert },
  stopped: { label: "Stopped", dotClassName: "text-warning", icon: CirclePause },
};

export const OVERALL_STATUS_CONFIG: Record<
  OverallStatus,
  { label: string; className: string }
> = {
  idle: { label: "Idle", className: "bg-muted text-muted-foreground" },
  running: { label: "Running", className: "bg-primary/15 text-primary" },
  deployed: { label: "Deployed", className: "bg-success/15 text-success" },
  blocked: { label: "Blocked", className: "bg-warning/15 text-warning" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
  stopped: { label: "Stopped", className: "bg-warning/15 text-warning" },
};
