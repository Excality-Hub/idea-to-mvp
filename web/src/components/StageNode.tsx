import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STAGE_STATUS_CONFIG } from "@/components/status";
import { cn } from "@/lib/utils";
import { STAGE_NODE_WIDTH, type StageFlowNode } from "@/lib/workflowGraph";

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { label, status, latestEvent } = data;
  const config = STAGE_STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <button
        type="button"
        style={{ width: STAGE_NODE_WIDTH }}
        className={cn(
          "nodrag flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm",
          status === "running" && "border-primary/40",
        )}
      >
        <Icon className={cn("size-5 shrink-0", config.dotClassName, status === "running" && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{label}</span>
            <span className={cn("text-xs font-medium", config.dotClassName)}>{config.label}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {latestEvent ? latestEvent.message : "Waiting for this stage to start"}
          </p>
        </div>
      </button>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
