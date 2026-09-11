import { arrayMove } from "@dnd-kit/sortable";

export type SlotKey = "afterAnalyst" | "afterArchitect" | "afterQa";

export interface SlotsState {
  afterAnalyst: string[];
  afterArchitect: string[];
  afterQa: string[];
}

export type DragActive =
  | { type: "palette"; agentId: string }
  | { type: "slot-item"; slot: SlotKey; agentId: string };

export type DragOver =
  | { type: "slot"; slot: SlotKey }
  | { type: "slot-item"; slot: SlotKey; agentId: string };

export function applyDragEnd(slots: SlotsState, active: DragActive, over: DragOver | undefined): SlotsState {
  if (!over) return slots;

  if (active.type === "palette") {
    if (slots[over.slot].includes(active.agentId)) return slots;
    return { ...slots, [over.slot]: [...slots[over.slot], active.agentId] };
  }

  if (active.slot !== over.slot) {
    return slots;
  }
  if (over.type === "slot") {
    return slots;
  }
  const fromIndex = slots[active.slot].indexOf(active.agentId);
  const toIndex = slots[over.slot].indexOf(over.agentId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return slots;
  return { ...slots, [active.slot]: arrayMove(slots[active.slot], fromIndex, toIndex) };
}
