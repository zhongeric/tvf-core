export type ChainId = 1 | 4663;
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "code" | "control" | "trading" | "supply" | "liquidity" | "identity";
export type ParamType = "bps" | "days" | "usd" | "count";

export type TvfParam = { type: ParamType; default: number; min: number; max: number };

export type TvfCheck = {
  id: string;
  category: Category;
  fact: string;
  params?: Record<string, TvfParam>;
  definitions: Record<string, string>;
  sources: string[];
  riskIf: boolean;
  severity: Severity;
  window: { hours: number };
};

export type TvfScoring = {
  weights: { critical: 100; high: 25; medium: 10; low: 3; info: 0 };
  verdict: { fail: "anyCriticalRisky"; warn: { scoreBelow: 70; orHighUnanswered: true } };
  unanswered: "severityMinusOne";
};

export type TvfReviewConfig = {
  action: "oracle.request";
  question: string;
  answerType: "bool";
  evidence: "panel";
  panelSize: number;
  quorum: number;
  window: { hours: number };
  validForSeconds: number;
  definitions: Record<string, string>;
  guards: { sources: string[]; minSources: number };
  allowAmbiguous: false;
};

export type TvfFramework = {
  tvf: "1";
  id: string;
  version: string;
  extends?: { id: string; version: string };
  chains: ChainId[];
  subject: { token: "address"; pool?: "PoolRef" };
  checks: TvfCheck[];
  scoring: TvfScoring;
  review?: TvfReviewConfig;
  hash: string;
};

export type TvfProposal = {
  proposal: "1";
  id: string;
  base: { id: "core"; version: string; hash?: string };
  next: { id: "core"; version: string; hash?: string };
  checks: string[];
  summary: string;
  rationale: string;
  proposer: string;
  source: "external" | "drafting-job";
};
