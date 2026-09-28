import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import { Form } from "../../components/ui/form";
import "./owner-contacts.css";

type Budget = {
  enabled: boolean;
  period: string;
  configuredCap: number | null;
  effectiveCap: number | null;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number | null;
};
type JobSummary = {
  id: string;
  placeId: string;
  firstName: string;
  lastName: string;
  company: string;
  status: string;
  createdAt: string;
};
type Review = {
  job: JobSummary & {
    companyDomain: string;
    personSource: string;
    budgetPeriod: string;
    reservedCredits: number;
    contextHash: string;
    providerRequestId: string | null;
    lastError: string | null;
  };
  privateReviewContact: {
    email: string;
    providerEmailStatus: string;
    reviewOnly: boolean;
    outreachEligible: boolean;
  } | null;
};
type RequestFields = {
  placeId: string;
  firstName: string;
  lastName: string;
  company: string;
  companyDomain: string;
  personSource: string;
  optIn: boolean;
};

async function privateApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const payload = await response.json() as { success: boolean; data?: T; error?: string };
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error ?? "Private contact request failed.");
  }
  return payload.data;
}

const terminalStatuses = new Set(["completed", "failed", "submit_ambiguous", "timed_out"]);
const statusText: Record<string, string> = {
  reserved: "Credit reserved; waiting to submit",
  submitting: "Submitting to provider",
  polling: "Waiting for provider",
  polling_active: "Checking provider",
  on_hold: "On hold at provider",
  completed: "Completed",
  failed: "Submission rejected",
  submit_ambiguous: "Submission uncertain — do not retry",
  timed_out: "Provider result timed out — do not retry",
};

function OwnerContactsContent() {
  const [searchParams] = useSearchParams();
  const form = useForm<RequestFields>({
    defaultValues: {
      placeId: searchParams.get("placeId") ?? "", firstName: "", lastName: "", company: "",
      companyDomain: "", personSource: "", optIn: false,
    },
  });
  const [budget, setBudget] = useState<Budget | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [providerId, setProviderId] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [replacementId, setReplacementId] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionConfirmed, setCorrectionConfirmed] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0);

  const refreshOverview = useCallback(async () => {
    const [nextBudget, nextJobs] = await Promise.all([
      privateApi<Budget>("/private-contact-enrichments/budget"),
      privateApi<JobSummary[]>("/private-contact-enrichments"),
    ]);
    setBudget(nextBudget);
    setJobs(nextJobs);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      privateApi<Budget>("/private-contact-enrichments/budget"),
      privateApi<JobSummary[]>("/private-contact-enrichments"),
    ]).then(([nextBudget, nextJobs]) => {
      if (!active) return;
      setBudget(nextBudget);
      setJobs(nextJobs);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load private contacts.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setReview(null);
      return;
    }
    let active = true;
    let terminal = false;
    let pending = false;
    setReview(null);
    setDetailLoading(true);
    setError("");
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const nextReview = await privateApi<Review>(
          `/private-contact-enrichments/${encodeURIComponent(selectedId)}`,
        );
        if (!active) return;
        setReview(nextReview);
        setDetailLoading(false);
        terminal = terminalStatuses.has(nextReview.job.status);
        if (terminal) {
          void refreshOverview().catch(() => {});
        }
      } catch (failure) {
        if (active) {
          setDetailLoading(false);
          setError(failure instanceof Error ? failure.message : "Could not load review.");
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!active || terminal) return;
      void load();
    }, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedId, refreshOverview, reviewVersion]);

  const submit = form.handleSubmit(async (values) => {
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const result = await privateApi<{ id: string; created: boolean; status: string }>(
        `/restaurants/${encodeURIComponent(values.placeId.trim())}/private-contact-enrichments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            company: values.company.trim(),
            companyDomain: values.companyDomain.trim(),
            personSource: values.personSource.trim(),
            optIn: true,
            maxCredits: 1,
          }),
        },
      );
      setSelectedId(result.id);
      setNotice(result.created
        ? "One credit reserved. This is a private review request, not an outreach action."
        : "This person and company already have a request. Opened the existing review; no new credit reserved.");
      form.reset();
      await refreshOverview();
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Request failed."} If the outcome is uncertain, check recent requests before trying again.`);
      void refreshOverview().catch(() => {});
    } finally {
      setSubmitting(false);
    }
  });

  const reconcile = async () => {
    if (!review || !selectedId) return;
    setReconciling(true);
    setError("");
    setNotice("");
    try {
      await privateApi(`/private-contact-enrichments/${encodeURIComponent(selectedId)}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedIdentity: identityConfirmed,
          providerRequestId: review.job.providerRequestId ?? providerId.trim(),
          contextHash: review.job.contextHash,
          placeId: review.job.placeId,
          firstName: review.job.firstName,
          lastName: review.job.lastName,
          companyDomain: review.job.companyDomain,
        }),
      });
      setReview(await privateApi<Review>(`/private-contact-enrichments/${encodeURIComponent(selectedId)}`));
      setReviewVersion((version) => version + 1);
      await refreshOverview();
      setProviderId("");
      setIdentityConfirmed(false);
      setNotice("Provider request confirmed. Polling resumed without submitting a new lookup.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Provider request could not be confirmed.");
    } finally {
      setReconciling(false);
    }
  };

  const correctRequestId = async () => {
    if (!review || !selectedId || !review.job.providerRequestId) return;
    setCorrecting(true);
    setError("");
    setNotice("");
    try {
      await privateApi(`/private-contact-enrichments/${encodeURIComponent(selectedId)}/correct-request-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldProviderRequestId: review.job.providerRequestId,
          newProviderRequestId: replacementId.trim(),
          evidenceNote: correctionNote.trim(),
          confirmedCorrection: correctionConfirmed,
        }),
      });
      setReview(await privateApi<Review>(`/private-contact-enrichments/${encodeURIComponent(selectedId)}`));
      setReviewVersion((version) => version + 1);
      await refreshOverview();
      setReplacementId("");
      setCorrectionNote("");
      setCorrectionConfirmed(false);
      setNotice("Provider evidence confirmed the correction. Polling resumed; no new paid request was submitted.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Provider request ID could not be corrected.");
    } finally {
      setCorrecting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="owner-contacts">
        <header>
          <p className="eyebrow">The Food Advisor Admin / Private review</p>
          <h1>Owner contacts</h1>
          <p>Request a provider lookup for a known person. Results stay in this admin-only review area and are never used for automatic outreach or public listings.</p>
        </header>
        {error && <p role="alert" className="contact-error" data-testid="status-contact-error">{error}</p>}
        {notice && <p role="status" className="contact-notice" data-testid="status-contact-notice">{notice}</p>}
        <section className="contact-panel" aria-label="Monthly credit budget">
          <h2>Monthly credit budget</h2>
          {loading ? <p>Loading budget…</p> : budget ? (
            <>
              <p data-testid="text-contact-budget">
                {budget.enabled
                  ? `${budget.period} · Configured cap: ${budget.configuredCap} · Effective cap: ${budget.effectiveCap} · Reserved: ${budget.reservedCredits} · Consumed: ${budget.consumedCredits} · Available: ${budget.availableCredits}`
                  : "BetterContact is disabled or no valid monthly credit cap is configured."}
              </p>
              <small>The effective cap may be lower than the configured cap for an existing month. Each new request reserves up to one credit.</small>
            </>
          ) : <p>Budget unavailable. Requests are disabled until it can be loaded.</p>}
        </section>
        <section className="contact-panel" aria-label="New private contact request">
          <h2>Request a private lookup</h2>
          <Form {...form}>
            <form onSubmit={submit} className="contact-form">
              {([
                ["placeId", "Restaurant place ID", "Use the exact restaurant place ID from the listing."],
                ["firstName", "Person’s first name", "A real, independently identified person."],
                ["lastName", "Person’s last name", ""],
                ["company", "Company name", "The company associated with this person."],
                ["companyDomain", "Company domain", "Example: restaurant.com (not a URL)."],
                ["personSource", "Person and company provenance", "Where did you find this named person and their connection to this company? Include a source or explanation."],
              ] as const).map(([name, label, hint]) => (
                <label key={name} className="contact-field">
                  <span>{label}</span>
                  {hint && <small>{hint}</small>}
                  <input
                    data-testid={`input-contact-${name}`}
                    {...form.register(name, { required: true, minLength: name === "personSource" ? 5 : name === "placeId" ? 1 : 2 })}
                    maxLength={name === "placeId" ? 512 : name === "personSource" ? 500 : name === "companyDomain" ? 253 : name === "company" ? 200 : 100}
                    required
                    autoComplete="off"
                    disabled={submitting}
                  />
                  {form.formState.errors[name] && <small role="alert">This field is required and must be long enough.</small>}
                </label>
              ))}
              <label className="contact-consent">
                <input type="checkbox" data-testid="checkbox-contact-opt-in" {...form.register("optIn", { required: true })} disabled={submitting} />
                <span>I authorize this one-credit private lookup for the person and company above. It does not verify ownership or authorize sending.</span>
              </label>
              <button type="submit" data-testid="button-request-contact" disabled={submitting || loading || !budget?.enabled || (budget.availableCredits ?? 0) < 1}>
                {submitting ? "Reserving…" : "Reserve one credit and request lookup"}
              </button>
            </form>
          </Form>
        </section>
        <section className="contact-panel" aria-label="Recent private requests">
          <div className="contact-heading">
            <h2>Recent requests</h2>
            <button type="button" data-testid="button-refresh-contacts" onClick={() => { setError(""); void refreshOverview().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Refresh failed.")); }}>Refresh</button>
          </div>
          {!loading && jobs.length === 0 && <p>No requests yet.</p>}
          <ul className="contact-history">
            {jobs.map((job) => (
              <li key={job.id}>
                <button type="button" className={selectedId === job.id ? "selected" : ""} data-testid={`button-review-contact-${job.id}`} onClick={() => { setSelectedId(job.id); setProviderId(""); setIdentityConfirmed(false); setReplacementId(""); setCorrectionNote(""); setCorrectionConfirmed(false); }}>
                  <strong>{job.firstName} {job.lastName}</strong> · {job.company}
                  <span>{job.placeId} · {statusText[job.status] ?? job.status} · {new Date(job.createdAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {selectedId && (
          <section className="contact-panel" aria-label="Private contact review">
            <h2>Private review</h2>
            {detailLoading && <p role="status">Loading review…</p>}
            {review && (
              <div data-testid="panel-contact-review">
                <p data-testid="status-contact-job"><strong>Status:</strong> {statusText[review.job.status] ?? review.job.status}</p>
                <p><strong>Person:</strong> {review.job.firstName} {review.job.lastName}</p>
                <p><strong>Company:</strong> {review.job.company} · {review.job.companyDomain}</p>
                <p><strong>Provenance supplied:</strong> {review.job.personSource}</p>
                <p><strong>Restaurant place ID:</strong> {review.job.placeId}</p>
                <p><strong>Reservation:</strong> up to {review.job.reservedCredits} credit · {review.job.budgetPeriod}</p>
                {review.job.lastError && <p role="alert">{review.job.lastError}</p>}
                {review.privateReviewContact ? (
                  <div className="contact-result">
                    <p data-testid="text-private-contact-email"><strong>Private email:</strong> {review.privateReviewContact.email}</p>
                    <p data-testid="status-contact-deliverability">Provider-verified deliverability: {review.privateReviewContact.providerEmailStatus}</p>
                    <p><strong>Ownership:</strong> Not verified. Deliverability and a name match do not establish that this person owns the restaurant.</p>
                    <p>Review only · Not eligible for automatic outreach · Not added to the public business email.</p>
                  </div>
                ) : <p>No provider-accepted deliverable address is available for private review.</p>}
                {review.job.status === "submit_ambiguous" && <p>Provider submission may already have incurred a charge. Do not submit it again; investigate manually.</p>}
                {["submit_ambiguous", "timed_out", "on_hold"].includes(review.job.status) && (
                  <div className="contact-result">
                    <h3>Resume an existing provider request</h3>
                    <p>Check the original person, company, and restaurant in BetterContact first. This checks the provider request ID and resumes GET polling; it never sends another paid submission. Credits remain reserved until matching provider evidence confirms usage.</p>
                    {review.job.providerRequestId
                      ? <p><strong>Provider request ID:</strong> {review.job.providerRequestId}</p>
                      : <label className="contact-field"><span>Provider-confirmed request ID</span>
                          <input value={providerId} onChange={(event) => setProviderId(event.target.value)} maxLength={200} autoComplete="off" />
                        </label>}
                    <label className="contact-consent"><input type="checkbox" checked={identityConfirmed} onChange={(event) => setIdentityConfirmed(event.target.checked)} />
                      <span>I checked the original person, company domain, and restaurant against the provider’s request record.</span></label>
                    <button type="button" disabled={reconciling || !identityConfirmed || (!review.job.providerRequestId && !providerId.trim())}
                      onClick={() => { void reconcile(); }}>
                      {reconciling ? "Confirming…" : "Confirm identity and resume polling"}
                    </button>
                  </div>
                )}
                {review.job.providerRequestId && ["polling", "on_hold", "timed_out", "submit_ambiguous"].includes(review.job.status) && (
                  <div className="contact-result">
                    <h3>Correct a mistaken provider request ID</h3>
                    <p>Only use this if BetterContact has terminated records proving the current ID belongs to a different identity and the replacement ID matches this person, company, domain, and restaurant. Pending or incomplete records are not enough. The existing credit reservation remains in place; no new paid lookup is sent.</p>
                    <p><strong>Current ID:</strong> {review.job.providerRequestId}</p>
                    <label className="contact-field"><span>Replacement provider request ID</span>
                      <input value={replacementId} onChange={(event) => setReplacementId(event.target.value)} maxLength={200} autoComplete="off" disabled={correcting} />
                    </label>
                    <label className="contact-field"><span>Why the old ID is wrong and how the new ID was verified (audit note)</span>
                      <textarea value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} maxLength={1000} disabled={correcting} />
                    </label>
                    <label className="contact-consent"><input type="checkbox" checked={correctionConfirmed} onChange={(event) => setCorrectionConfirmed(event.target.checked)} disabled={correcting} />
                      <span>I reviewed both provider records and confirm this is a correction, not a new lookup.</span></label>
                    <button type="button" disabled={correcting || !correctionConfirmed || !replacementId.trim() || correctionNote.trim().length < 10 || replacementId.trim() === review.job.providerRequestId}
                      onClick={() => { void correctRequestId(); }}>
                      {correcting ? "Checking provider evidence…" : "Verify evidence and correct ID"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </AdminLayout>
  );
}

export default function AdminOwnerContacts() {
  return <RequireAdmin><OwnerContactsContent /></RequireAdmin>;
}