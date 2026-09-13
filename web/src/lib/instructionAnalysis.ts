import { encode } from "gpt-tokenizer";

export type ComplexityLabel = "Low" | "Medium" | "High";

export type CostTier = "Low" | "Medium" | "High";

export interface InstructionAnalysis {
  tokenEstimate: number;
  wordCount: number;
  complexityLabel: ComplexityLabel;
  clarityScore: number;
  costTier: CostTier;
  riskFlags: string[];
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

function countDirectives(text: string): number {
  return text
    .split(/[.!?\n]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0).length;
}

const BRANCHING_PATTERN = /\b(if|unless|otherwise|depending on|else)\b/gi;

function countBranching(text: string): number {
  return [...text.matchAll(BRANCHING_PATTERN)].length;
}

function complexityScore(text: string, tokenEstimate: number): number {
  const directiveCount = countDirectives(text);
  const branchingCount = countBranching(text);
  return directiveCount * 8 + branchingCount * 10 + Math.floor(tokenEstimate / 20);
}

function tierForScore(score: number): "Low" | "Medium" | "High" {
  if (score < 30) return "Low";
  if (score < 65) return "Medium";
  return "High";
}

const REPO_ACCESS_COST_BUMP = 25;

function costTierForScore(score: number, repoAccess: boolean): CostTier {
  return tierForScore(score + (repoAccess ? REPO_ACCESS_COST_BUMP : 0));
}

const AMBIGUOUS_PATTERN = /\b(some|appropriate|various|etc|and so on|somehow|reasonable)\b/gi;

function countAmbiguous(text: string): number {
  return [...text.matchAll(AMBIGUOUS_PATTERN)].length;
}

const VOWEL_PATTERN = /[aeiou]/i;

function isGibberishWord(word: string): boolean {
  const isAcronym = word === word.toUpperCase();
  return word.length >= 4 && !VOWEL_PATTERN.test(word) && !isAcronym;
}

function gibberishRatio(text: string): number {
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z]/g, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) return 0;
  const gibberishCount = words.filter(isGibberishWord).length;
  return gibberishCount / words.length;
}

function clarityScore(text: string): number {
  const gibberishPenalty = Math.round(gibberishRatio(text) * 100);
  return Math.max(0, 100 - countAmbiguous(text) * 25 - gibberishPenalty);
}

const UNBOUNDED_SCOPE_PATTERN = /\b(all|every|entire|whole)\b/i;

function buildRiskFlags(text: string, complexityLabel: ComplexityLabel, repoAccess: boolean): string[] {
  const flags: string[] = [];
  if (UNBOUNDED_SCOPE_PATTERN.test(text)) {
    flags.push(
      'Unbounded scope language detected (e.g. "all", "every", "entire") — may cause runaway token usage.',
    );
  }
  if (countAmbiguous(text) > 0) {
    flags.push("Vague or ambiguous language detected — may cause inconsistent agent behavior.");
  }
  if (gibberishRatio(text) > 0) {
    flags.push("Instructions contain text that doesn't look like real words — check for typos or placeholder text.");
  }
  if (repoAccess && complexityLabel !== "Low") {
    flags.push(
      "Repo access combined with complex instructions can multiply real token usage well beyond this estimate.",
    );
  }
  return flags;
}

export function analyzeInstructions(instructions: string, repoAccess: boolean): InstructionAnalysis {
  const tokenEstimate = encode(instructions).length;
  const score = complexityScore(instructions, tokenEstimate);
  const complexityLabel = tierForScore(score);
  return {
    tokenEstimate,
    wordCount: countWords(instructions),
    complexityLabel,
    clarityScore: clarityScore(instructions),
    costTier: costTierForScore(score, repoAccess),
    riskFlags: buildRiskFlags(instructions, complexityLabel, repoAccess),
  };
}
