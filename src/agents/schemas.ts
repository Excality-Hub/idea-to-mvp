import { z } from "zod";

export const AnalystOutputSchema = z.object({
  summary: z.string(),
  goals: z.array(z.string()),
  keyFeatures: z.array(z.string()),
  nonGoals: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

export const ArchitectOutputSchema = z.object({
  issueTitle: z.string(),
  issueBody: z.string(),
  branchName: z.string(),
});
export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;

export const DeveloperOutputSchema = z.object({
  prTitle: z.string(),
  prBody: z.string(),
});
export type DeveloperOutput = z.infer<typeof DeveloperOutputSchema>;

export const QAFindingSchema = z.object({
  severity: z.enum(["info", "minor", "major", "critical"]),
  category: z.string(),
  summary: z.string(),
  file: z.string(),
  line: z.number(),
});
export type QAFinding = z.infer<typeof QAFindingSchema>;

export const QAOutputSchema = z.object({
  verdict: z.enum(["pass", "block"]),
  findings: z.array(QAFindingSchema),
});
export type QAOutput = z.infer<typeof QAOutputSchema>;
