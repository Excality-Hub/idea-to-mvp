import { z } from "zod";

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  createdAt: string;
}

export const AgentDefinitionInputSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  repoAccess: z.boolean(),
});
export type AgentDefinitionInput = z.infer<typeof AgentDefinitionInputSchema>;
