export type BusinessEmailResearchClassification = {
  status: string;
  email: string | null;
  emailSourceUrl: string | null;
  reason: string | null;
  auditEvent: string;
  extractionSucceeded: boolean;
};

export type BusinessEmailResearchCounts = {
  succeeded: number;
  failed: number;
  skipped: number;
};

export function countBusinessEmailResearchOutcome(
  counts: BusinessEmailResearchCounts,
  outcome: keyof BusinessEmailResearchCounts,
): void {
  counts[outcome] += 1;
}

export function classifyBusinessEmailResearch(input: {
  websitePresent: boolean;
  extractionSucceeded: boolean;
  email?: string | null;
  emailSourceUrl?: string | null;
  extractionError?: string;
}): BusinessEmailResearchClassification {
  if (!input.websitePresent) {
    return {
      status: "no_business_email",
      email: null,
      emailSourceUrl: null,
      reason: "Restaurant has no website to check.",
      auditEvent: "email_not_found",
      extractionSucceeded: false,
    };
  }
  if (!input.extractionSucceeded) {
    return {
      status: "extraction_failed",
      email: null,
      emailSourceUrl: null,
      reason: (input.extractionError || "Website extraction failed.").slice(0, 500),
      auditEvent: "extraction_failed",
      extractionSucceeded: false,
    };
  }
  if (!input.email) {
    return {
      status: "no_business_email",
      email: null,
      emailSourceUrl: input.emailSourceUrl ?? null,
      reason: "No allowlisted role mailbox was published.",
      auditEvent: "email_not_found",
      extractionSucceeded: true,
    };
  }
  return {
    status: "pending",
    email: input.email,
    emailSourceUrl: input.emailSourceUrl ?? null,
    reason: null,
    auditEvent: "email_discovered",
    extractionSucceeded: true,
  };
}