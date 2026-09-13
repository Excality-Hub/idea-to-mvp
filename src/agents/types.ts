import { z } from "zod";
import { DATA_KINDS, type DataKind } from "./dataKinds.js";

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  inputs?: DataKind[];
  outputs?: DataKind[];
  createdAt: string;
}

export const AgentDefinitionInputSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  repoAccess: z.boolean(),
  inputs: z.array(z.enum(DATA_KINDS)).default([]),
  outputs: z.array(z.enum(DATA_KINDS)).default([]),
});
export type AgentDefinitionInput = z.infer<typeof AgentDefinitionInputSchema>;
