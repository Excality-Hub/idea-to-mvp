import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { STAGE_STATUS_CONFIG } from "@/components/status";
import { cn } from "@/lib/utils";
import { isAbortableStage, isGateStage } from "@/types";
import { STAGE_NODE_WIDTH, type StageFlowNode } from "@/lib/workflowGraph";

/** Returns an error message when the action failed, or undefined on success. */
async function postRunAction(path: string): Promise<string | undefined> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST" });
  } catch {
    return "Could not reach the server";
  }
  if (res.ok) return undefined;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Request failed (${res.status})`;
}

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { stage, label, status, latestEvent, readOnly, projectId } = data;
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  async function runAction(path: string): Promise<void> {
    setActionError(await postRunAction(path));
  }

  const config = STAGE_STATUS_CONFIG[status];
  const Icon = config.icon;
  const abortable = isAbortableStage(stage);
  const isGate = isGateStage(stage);
  const gateId = isGate ? stage.slice("gate:".length) : undefined;

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        style={{ width: STAGE_NODE_WIDTH }}
        className={cn(
          "nodrag flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm",
          status === "running" && "border-primary/40",
        )}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left">
          <Icon className={cn("size-5 shrink-0", config.dotClassName, status === "running" && "animate-spin")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{label}</span>
              <span className={cn("text-xs font-medium", config.dotClassName)}>{config.label}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {latestEvent ? latestEvent.message : "Waiting for this stage to start"}
            </p>
            {actionError && <p className="mt-0.5 truncate text-sm text-destructive">{actionError}</p>}
          </div>
        </button>
        {abortable && status === "running" && !readOnly && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              void runAction(`/api/projects/${projectId}/run/stop`);
            }}
          >
            Stop
          </Button>
        )}
        {isGate && status === "stopped" && !readOnly && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                void runAction(`/api/projects/${projectId}/run/gates/${gateId}/approve`);
              }}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                void runAction(`/api/projects/${projectId}/run/gates/${gateId}/reject`);
              }}
            >
              Reject
            </Button>
          </div>
        )}
        {abortable && status === "stopped" && !readOnly && (
          <Button
            type="button"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              void runAction(`/api/projects/${projectId}/run/resume`);
            }}
          >
            Resume
          </Button>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
