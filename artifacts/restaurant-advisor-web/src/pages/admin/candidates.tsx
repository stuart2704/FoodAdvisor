import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOsmCandidateQueryKey, getListOsmCandidatesQueryKey, getListOsmCandidateOutreachLogsQueryKey,
  useListOsmCandidates, useGetOsmCandidate, useListOsmCandidateOutreachLogs,
  useReviewOsmCandidate, useSuppressOsmCandidate, useSendOsmClaimInvite,
  useResendOsmClaimInvite, useDecideOsmCandidateEvidence, useSetOsmCandidateOutreachBlocked,
  useSetOsmCandidateAutoInvite,
} from "@workspace/api-client-react";
import type { OsmCandidateWorkflow, OsmCandidateState } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { adminRequest, readableError } from "../osm-shared";
import "../osm-workflow.css";

const panels: { label: string; state: OsmCandidateState; description: string }[] = [
  { label: "Unverified", state: "unverified", description: "Open-data leads waiting for a human review." },
  { label: "Reviewed", state: "reviewed", description: "Checked leads ready for an invitation to the owner." },
  { label: "Claim Invited", state: "claim_invited", description: "Invitations sent; awaiting email verification and ownership evidence." },
  { label: "Claim Verified", state: "claim_verified", description: "Owner evidence received. Approve both proofs before activation." },
  { label: "Activated Listings", state: "activated", description: "Listings moved through the activation pipeline." },
  { label: "Suppressed", state: "suppressed", description: "Leads intentionally excluded from outreach and publication." },
];

function safeEvidenceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function CandidateDetail({ row, close }: { row: OsmCandidateWorkflow; close: () => void }) {
  const client = useQueryClient();
  const { sourceName, sourceId } = row.candidate;
  const candidate = useGetOsmCandidate(sourceName, sourceId, { request: adminRequest });
  const logs = useListOsmCandidateOutreachLogs(sourceName, sourceId, { request: adminRequest });
  const review = useReviewOsmCandidate({ request: adminRequest });
  const suppress = useSuppressOsmCandidate({ request: adminRequest });
  const invite = useSendOsmClaimInvite({ request: adminRequest });
  const resend = useResendOsmClaimInvite({ request: adminRequest });
  const decide = useDecideOsmCandidateEvidence({ request: adminRequest });
  const outreach = useSetOsmCandidateOutreachBlocked({ request: adminRequest });
  const autoInvite = useSetOsmCandidateAutoInvite({ request: adminRequest });
  const [email, setEmail] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [contactEvidence, setContactEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const item = candidate.data ?? row;
  const c = item.candidate;
  const pending = review.isPending || suppress.isPending || invite.isPending || resend.isPending || decide.isPending || outreach.isPending || autoInvite.isPending;

  async function run(action: () => Promise<unknown>, success: string) {
    setError(""); setMessage("");
    try {
      await action();
      await Promise.all([
        client.invalidateQueries({ queryKey: getListOsmCandidatesQueryKey() }),
        client.invalidateQueries({ queryKey: getGetOsmCandidateQueryKey(sourceName, sourceId) }),
        client.invalidateQueries({ queryKey: getListOsmCandidateOutreachLogsQueryKey(sourceName, sourceId) }),
      ]);
      setMessage(success);
    } catch (e) { setError(readableError(e)); }
  }

  return <div className="osm-card" data-testid="panel-candidate-detail">
    <div className="osm-top"><div><span className="osm-eyebrow">Candidate review · {sourceName} / {sourceId}</span><h2>{c.name}</h2><p className="osm-small">{c.address ?? "Address not provided"} · Imported {new Date(c.importedAt).toLocaleDateString()}</p></div><button className="osm-btn quiet" onClick={close} data-testid="button-close-candidate">Close</button></div>
    {candidate.isLoading && <div className="osm-skeleton" />}
    {candidate.isError && <div className="osm-error" role="alert">Could not refresh candidate details. <button className="osm-btn quiet" onClick={() => void candidate.refetch()} data-testid="button-retry-candidate">Retry</button></div>}
    {error && <div className="osm-error" role="alert" data-testid="status-candidate-error">{error}</div>}
    {message && <div className="osm-success" role="status" data-testid="status-candidate-success">{message}</div>}
    <div className="osm-split">
      <section>
        <h3>Review & outreach</h3>
        <p className="osm-small">Phone: {c.phone || "Not supplied"} · Website: {c.website || "Not supplied"} · Coordinates: {c.latitude ?? "—"}, {c.longitude ?? "—"}</p>
        <p className="osm-small">Identity email verified: {c.identityVerified ? "Yes" : "No"} · Source rights confirmed: {c.rightsConfirmed ? "Yes" : "No"} · Required fields complete: {c.requiredFieldsComplete ? "Yes" : "No"}</p>
        <div className="osm-card subtle" data-testid="panel-auto-invite">
          <h3>Automatic claim invitations</h3>
          <p className="osm-small">Separate opt-in for a reviewed high-confidence lead. Confirm a business contact from a trusted source; OSM contact tags alone are not approval. First email waits at least 48 hours after both reviews. Up to three attempts, at least seven days apart. This does not publish the listing.</p>
          <p data-testid="status-auto-invite">Status: <strong>{c.autoInviteStatus}</strong>{c.autoInviteDueAt ? ` · Next eligible ${new Date(c.autoInviteDueAt).toLocaleString()}` : ""} · {c.inviteCount}/3 attempts</p>
          <p className="osm-small">Approved contact: {c.approvedContactEmail || "None"}{c.contactApprovedAt ? ` · Approved ${new Date(c.contactApprovedAt).toLocaleString()}` : ""}</p>
          {c.contactEvidence && <p className="osm-small">Contact source: {c.contactEvidence}</p>}
          {c.autoInviteStatus === "unknown" && <p className="osm-error" role="alert">Delivery may have succeeded. Automatic retries are blocked; investigate before any further contact.</p>}
          {c.autoInviteStatus === "failed" && <p className="osm-small">The provider rejected the last attempt. A further attempt is not due until the date shown.</p>}
          {c.autoInviteEnabled ? <button className="osm-btn quiet" disabled={pending} onClick={() => void run(() => autoInvite.mutateAsync({ sourceName, sourceId, data: { enabled: false } }), "Automatic invitations disabled. An email already being submitted may still complete.")} data-testid="button-disable-auto-invite">Disable automatic invitations</button>
            : c.reviewed && c.highConfidence && !c.claimed && !c.suppressed && !c.published && !c.outreachBlocked && <form onSubmit={e => {
              e.preventDefault();
              if (!window.confirm(`Approve ${businessEmail} as a business contact for ${c.name} and opt in to delayed automatic invitations?`)) return;
              void run(() => autoInvite.mutateAsync({sourceName, sourceId, data: { enabled: true, email: businessEmail, evidence: contactEvidence }}), "Contact approved; automatic invitations opted in.");
            }}>
              <label className="osm-field">Verified business contact email<input type="email" required maxLength={254} value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} data-testid="input-auto-contact" /></label>
              <label className="osm-field">Where you verified this contact and why it represents the business<textarea required minLength={10} maxLength={2000} value={contactEvidence} onChange={e => setContactEvidence(e.target.value)} data-testid="input-auto-evidence" /></label>
              <button className="osm-btn" type="submit" disabled={pending} data-testid="button-enable-auto-invite">Approve contact & opt in</button>
            </form>}
          <p className="osm-small">Global automatic sending must also be enabled on the server. Turning this off cannot cancel a message already being submitted.</p>
        </div>
        <div className="osm-actions">
          {c.state === "unverified" && <button disabled={pending} className="osm-btn" onClick={() => void run(() => review.mutateAsync({ sourceName, sourceId }), "Marked as reviewed.")} data-testid="button-review-candidate">Mark reviewed</button>}
          {!c.suppressed && <button disabled={pending} className="osm-btn danger" onClick={() => { if (window.confirm("Suppress this lead and block further outreach?")) void run(() => suppress.mutateAsync({ sourceName, sourceId, data: { reason } }), "Candidate suppressed."); }} data-testid="button-suppress-candidate">Reject / suppress</button>}
          <button disabled={pending} className="osm-btn quiet" onClick={() => void run(() => outreach.mutateAsync({ sourceName, sourceId, data: { blocked: !c.outreachBlocked } }), c.outreachBlocked ? "Outreach unblocked." : "Outreach blocked.")} data-testid="button-toggle-outreach">{c.outreachBlocked ? "Allow outreach" : "Block outreach"}</button>
        </div>
        {!c.suppressed && <label className="osm-field" style={{marginTop:18}}>Reason for suppression (optional)<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-suppression-reason" /></label>}
        {c.state === "reviewed" && !c.outreachBlocked && <form onSubmit={e => { e.preventDefault(); void run(() => invite.mutateAsync({sourceName,sourceId,data:{sentTo:email,method:"email"}}), "Invitation requested. Check delivery status below."); }}>
          <label className="osm-field">Owner email address<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@restaurant.com" data-testid="input-invite-email" /></label>
          {import.meta.env.DEV && <p className="osm-small">Email invitations become available after this claim flow is published, so development cannot send links to an older live site.</p>}
          <button disabled={pending || import.meta.env.DEV} className="osm-btn" type="submit" data-testid="button-send-invite">Send claim invitation</button>
        </form>}
        {c.state === "claim_invited" && c.inviteCount < 3 && !c.outreachBlocked && <button disabled={pending} className="osm-btn quiet" onClick={() => { if (window.confirm("Resend this invitation to the last contact?")) void run(() => resend.mutateAsync({sourceName,sourceId}), "Invitation resent."); }} data-testid="button-resend-invite">Resend invitation · {c.inviteCount}/3 sent</button>}
        <div className="osm-note">Candidate details include OpenStreetMap data © OpenStreetMap contributors (ODbL). <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Source and licence details</a>. Email verification confirms access to the inbox, not ownership of the business. Ownership and rights require separate approval.</div>
        <h3>Evidence decisions</h3>
        <p className="osm-small">Review the actual submitted material before making each independent decision. External evidence links open in a new tab.</p>
        <label className="osm-field">Reviewer note (optional)<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} data-testid="input-reviewer-note" /></label>
        {(["ownership","source_rights"] as const).map(kind => {
          const title = kind === "ownership" ? "Business ownership" : "Source reuse rights";
          const submission = kind === "ownership" ? item.evidence.ownershipSubmission : item.evidence.sourceRightsSubmission;
          const status = kind === "ownership" ? item.evidence.ownershipStatus : item.evidence.rightsStatus;
          const evidenceUrl = safeEvidenceUrl(submission?.evidenceUrl ?? null);
          const submittedTime = submission ? new Date(submission.submittedAt).toLocaleString() : null;
          return <section className="osm-card subtle" key={kind} data-testid={`panel-evidence-${kind}`}>
            <div className="osm-top"><h3>{title}</h3><span className={`osm-pill ${status === "approved" ? "good" : "dim"}`} data-testid={`status-evidence-${kind}`}>{status.replaceAll("_"," ")}</span></div>
            {submission ? <>
              <p className="osm-small" data-testid={`text-submitted-${kind}`}>Submitted {submittedTime}</p>
              <p className="osm-evidence-description" data-testid={`text-description-${kind}`}>{submission.description}</p>
              <p className="osm-small">Supporting evidence: {evidenceUrl ? <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-evidence-${kind}`}>Open submitted link ↗</a> : submission.evidenceUrl ? "Link unavailable (unsupported or invalid URL)" : "No link provided"}</p>
              <p className="osm-small" data-testid={`text-attribution-${kind}`}>Source attribution: {submission.sourceAttribution || "Not provided"}</p>
              {submission.reviewedAt && <p className="osm-small">Last reviewed {new Date(submission.reviewedAt).toLocaleString()}{submission.reviewedBy ? ` by ${submission.reviewedBy}` : ""}{submission.reviewerNote ? ` · ${submission.reviewerNote}` : ""}</p>}
            </> : <p className="osm-small">No {title.toLowerCase()} submission received yet. Decisions are unavailable until material is submitted.</p>}
            <div className="osm-actions">{(["approved","rejected"] as const).map(decision => <button key={decision} disabled={pending || candidate.isFetching || candidate.isError || !submission} className={`osm-btn ${decision === "rejected" ? "quiet" : ""}`} onClick={() => {
              if (!submission) return;
              if (decision === "approved" && !window.confirm(`Approve ${title.toLowerCase()} evidence for ${c.name}?\n\nSubmission from ${submittedTime}:\n“${submission.description.slice(0,160)}${submission.description.length > 160 ? "…" : ""}”\n\nThis approval applies only to this evidence category.`)) return;
              void run(() => decide.mutateAsync({sourceName,sourceId,data:{kind,decision,reviewerNote:note || null}}), `${title} ${decision}.`);
            }} data-testid={`button-${decision}-${kind}`}>{decision === "approved" ? "Approve this evidence" : "Reject this evidence"}</button>)}</div>
          </section>;
        })}
      </section>
      <aside>
        <div className="osm-card subtle"><h3>Activation progress</h3><div className="osm-progress">{(["promoted","enriched","scored","published"] as const).map(step => <span key={step} className={item.activation[step] ? "done" : ""}>{step}</span>)}</div><p className="osm-small">Current step: {item.activation.currentStep || "Not started"}</p>{item.activation.errors.map((e,i) => <p key={i} className="osm-error">{e.step}: {e.errorCode} · {new Date(e.timestamp).toLocaleString()}</p>)}</div>
        <div className="osm-card subtle"><h3>Outreach log</h3>{logs.isLoading ? <div className="osm-skeleton" /> : logs.isError ? <button className="osm-btn quiet" onClick={() => void logs.refetch()} data-testid="button-retry-logs">Retry logs</button> : !logs.data?.length ? <p className="osm-small">No delivery attempts recorded.</p> : <ul className="osm-list">{logs.data.map(log => <li key={log.id}><strong>{log.status}</strong> · {log.method}<br/><span className="osm-small">{log.sentTo || "Contact withheld"} · {new Date(log.createdAt).toLocaleString()}{log.errorCode ? ` · ${log.errorCode}` : ""}</span></li>)}</ul>}</div>
      </aside>
    </div>
  </div>;
}

export default function AdminCandidatesPage() {
  const [panel, setPanel] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<OsmCandidateWorkflow | null>(null);
  const params = { state: panels[panel].state, limit: 25, cursor };
  const list = useListOsmCandidates(params, { request: adminRequest });
  const published = useListOsmCandidates({state:"published",limit:25}, {request:adminRequest,query:{enabled:panel===4,queryKey:getListOsmCandidatesQueryKey({state:"published",limit:25})}});
  const rows = panel===4 ? [...(list.data?.items ?? []),...(published.data?.items ?? [])] : (list.data?.items ?? []);
  return <AdminLayout><div className="osm-page" style={{padding:0,background:"transparent"}}>
    <div className="osm-top"><div><span className="osm-eyebrow">The Food Advisor / Administration</span><h1>Candidate claims</h1><p className="osm-intro">A careful path from open-data lead to a listing diners can trust. No candidate is public until its ownership and source rights are reviewed.</p></div><Link to="/admin/restaurants" className="osm-btn quiet" data-testid="link-manage-restaurants">Manage restaurants</Link></div>
    <div className="osm-tabs" role="tablist" aria-label="Candidate workflow">{panels.map((p,i) => <button role="tab" aria-selected={panel===i} className={`osm-tab ${panel===i ? "active" : ""}`} key={p.label} onClick={() => {setPanel(i);setCursor(undefined);setSelected(null);}} data-testid={`tab-${p.state}`}>{p.label}</button>)}</div>
    <div className="osm-top"><div><h2>{panels[panel].label}</h2><p className="osm-intro">{panels[panel].description}</p></div><button className="osm-btn quiet" onClick={() => void list.refetch()} data-testid="button-refresh-candidates">Refresh list</button></div>
    {selected && <CandidateDetail key={`${selected.candidate.sourceName}:${selected.candidate.sourceId}`} row={selected} close={() => setSelected(null)} />}
    <section className="osm-card">{list.isLoading || (panel===4 && published.isLoading) ? <><div className="osm-skeleton"/><div className="osm-skeleton"/><div className="osm-skeleton"/></> : list.isError || (panel===4 && published.isError) ? <div className="osm-error" role="alert">Could not load candidates. Check your administrator session. <button className="osm-btn quiet" onClick={() => {void list.refetch();if(panel===4)void published.refetch();}} data-testid="button-retry-candidates">Try again</button></div> : !rows.length ? <div className="osm-empty"><h3>Nothing in this queue</h3><p>There are no candidates at this stage right now.</p></div> : <div className="osm-table-scroll"><table className="osm-table"><thead><tr><th>Name</th><th>Address</th><th>Status</th><th>Automatic invitations</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.candidate.sourceName}:${row.candidate.sourceId}`} data-testid={`row-candidate-${row.candidate.sourceId}`}><td><strong className="osm-strong">{row.candidate.name}</strong><br/><span className="osm-small">{row.candidate.sourceName} · {row.candidate.sourceId}</span></td><td>{row.candidate.address || <span className="osm-small">Not provided</span>}</td><td><span className={`osm-pill ${row.candidate.published ? "good" : ""}`}>{row.candidate.state.replaceAll("_"," ")}</span><br/><span className="osm-small">{row.evidence.ownershipStatus} / {row.evidence.rightsStatus}{row.activation.currentStep ? ` · ${row.activation.currentStep}` : ""}</span></td><td><span className={`osm-pill ${row.candidate.autoInviteStatus === "unknown" ? "danger" : ""}`}>{row.candidate.autoInviteStatus}</span>{row.candidate.autoInviteDueAt && <><br/><span className="osm-small">{new Date(row.candidate.autoInviteDueAt).toLocaleString()}</span></>}</td><td><button className="osm-btn quiet" onClick={() => setSelected(row)} data-testid={`button-open-candidate-${row.candidate.sourceId}`}>Review details</button></td></tr>)}</tbody></table></div>}
    {list.data?.nextCursor && <button className="osm-btn quiet" onClick={() => {setCursor(list.data?.nextCursor ?? undefined);setSelected(null);}} data-testid="button-next-candidates">Next page</button>}{cursor && <button className="osm-btn quiet" style={{marginLeft:8}} onClick={() => {setCursor(undefined);setSelected(null);}} data-testid="button-first-candidates">First page</button>}
    </section>
  </div></AdminLayout>;
}