import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useExchangeOsmClaimLink, useRequestOsmClaimVerificationCode, useSubmitOsmClaimVerificationCode, useSubmitOsmClaimEvidence, getGetOsmOwnerDashboardQueryKey } from "@workspace/api-client-react";
import { OWNER_SESSION_KEY, clearOwnerSession, ownerRequest, readableError } from "./osm-shared";
import "./osm-workflow.css";

export default function OsmClaimPage() {
  const { candidateId, token } = useParams<{candidateId:string;token:string}>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const started = useRef(false);
  const [phase, setPhase] = useState<"exchange"|"verify"|"evidence"|"done">("exchange");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [ownershipDescription, setOwnershipDescription] = useState("");
  const [rightsDescription, setRightsDescription] = useState("");
  const [ownershipEvidenceUrl, setOwnershipEvidenceUrl] = useState("");
  const [rightsEvidenceUrl, setRightsEvidenceUrl] = useState("");
  const [sourceAttribution, setSourceAttribution] = useState("© OpenStreetMap contributors");
  const exchange = useExchangeOsmClaimLink({ request: {credentials:"include",referrerPolicy:"no-referrer"} });
  const requestCode = useRequestOsmClaimVerificationCode({ request: ownerRequest() });
  const verify = useSubmitOsmClaimVerificationCode({ request: ownerRequest() });
  const evidence = useSubmitOsmClaimEvidence({ request: ownerRequest() });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Remove the one-use token from browser history before network or navigation.
    window.history.replaceState(window.history.state, "", `/claim/${encodeURIComponent(candidateId ?? "")}`);
    if (!token || !candidateId) { setError("This invitation link is incomplete. Ask for a new invitation."); return; }
    exchange.mutate({data:{claimToken:token}}, {
      onSuccess: async result => {
        sessionStorage.setItem(OWNER_SESSION_KEY, result.ownerSession);
        await client.removeQueries({queryKey:getGetOsmOwnerDashboardQueryKey()});
        setPhase("verify");
      },
      onError: e => setError(readableError(e)),
    });
    // This is a one-use exchange, intentionally run once, including under StrictMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(e: unknown) {
    if ((e as {status?:number;response?:{status?:number}})?.status === 401 || (e as {response?:{status?:number}})?.response?.status === 401) { clearOwnerSession(); setPhase("exchange"); }
    setError(readableError(e));
  }
  return <main className="osm-page"><div className="osm-wrap" style={{maxWidth:780}}>
    <span className="osm-eyebrow">The Food Advisor / Owner invitation</span><h1>Make it yours. Make it accurate.</h1>
    <p className="osm-intro">Your restaurant starts as a private open-data lead. Verify your email, tell us how you know this business, and confirm your right to reuse any information you submit. Nothing goes live automatically.</p>
    <div className="osm-progress"><span className={phase !== "exchange" ? "done" : ""}>01 · Secure invitation</span><span className={phase === "evidence" || phase === "done" ? "done" : ""}>02 · Email code</span><span className={phase === "done" ? "done" : ""}>03 · Ownership & rights</span></div>
    {error && <div role="alert" className="osm-error" data-testid="status-claim-error">{error}</div>}{notice && <div role="status" className="osm-success" data-testid="status-claim-notice">{notice}</div>}
    {phase === "exchange" && <section className="osm-card" style={{marginTop:24}}><h2>Checking your invitation</h2>{exchange.isPending ? <><div className="osm-skeleton"/><div className="osm-skeleton"/></> : <p>The invitation may have expired or already been used. Ask our team for a fresh link.</p>}</section>}
    {phase === "verify" && <section className="osm-card" style={{marginTop:24}}><span className="osm-eyebrow">Step 02 / Email</span><h2>Verify your contact address</h2><p className="osm-intro">We will send a short code to the address used for this invitation. This confirms inbox access only; our team will separately review your ownership evidence.</p><button className="osm-btn quiet" disabled={requestCode.isPending} onClick={() => {setError(""); requestCode.mutate(undefined,{onSuccess:()=>setNotice("Verification code requested. Check your invitation inbox."),onError:fail});}} data-testid="button-request-code">{requestCode.isPending ? "Sending…" : "Send verification code"}</button>
      <form style={{marginTop:25}} onSubmit={e => {e.preventDefault();setError("");verify.mutate({data:{code}},{onSuccess:()=>{setNotice("Email verified. Now submit the two pieces of evidence.");setPhase("evidence");},onError:fail});}}><label className="osm-field">Your email code<input required pattern="[0-9]{6,10}" inputMode="numeric" minLength={6} maxLength={10} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} placeholder="6–10 digits" data-testid="input-verification-code"/></label><button className="osm-btn" disabled={verify.isPending} type="submit" data-testid="button-verify-code">{verify.isPending ? "Verifying…" : "Verify code"}</button></form></section>}
    {phase === "evidence" && <section className="osm-card" style={{marginTop:24}}><span className="osm-eyebrow">Step 03 / Review material</span><h2>Tell us the full story</h2><p className="osm-intro">Explain your relationship to the business and the source of the information you are providing. Our team reviews each piece separately. Links are optional; please only provide evidence you have permission to share.</p>
      <form onSubmit={e=>{e.preventDefault();setError("");evidence.mutate({data:{ownershipDescription,rightsDescription,ownershipEvidenceUrl:ownershipEvidenceUrl||null,rightsEvidenceUrl:rightsEvidenceUrl||null,sourceAttribution}},{onSuccess:()=>{setPhase("done");setNotice("Evidence submitted for review.");void client.invalidateQueries({queryKey:getGetOsmOwnerDashboardQueryKey()});},onError:fail});}}>
        <label className="osm-field">How are you connected to this restaurant?<textarea required minLength={10} maxLength={4000} value={ownershipDescription} onChange={e=>setOwnershipDescription(e.target.value)} data-testid="input-ownership-description"/></label>
        <label className="osm-field">Ownership evidence link (optional)<input type="url" maxLength={2048} value={ownershipEvidenceUrl} onChange={e=>setOwnershipEvidenceUrl(e.target.value)} data-testid="input-ownership-url"/></label>
        <label className="osm-field">What rights do you have to use these details?<textarea required minLength={10} maxLength={4000} value={rightsDescription} onChange={e=>setRightsDescription(e.target.value)} data-testid="input-rights-description"/></label>
        <label className="osm-field">Rights evidence link (optional)<input type="url" maxLength={2048} value={rightsEvidenceUrl} onChange={e=>setRightsEvidenceUrl(e.target.value)} data-testid="input-rights-url"/></label>
        <label className="osm-field">Source attribution<input required maxLength={1000} value={sourceAttribution} onChange={e=>setSourceAttribution(e.target.value)} data-testid="input-source-attribution"/></label>
        <button className="osm-btn" type="submit" disabled={evidence.isPending} data-testid="button-submit-evidence">{evidence.isPending ? "Submitting…" : "Submit for review"}</button>
      </form></section>}
    {phase === "done" && <section className="osm-card" style={{marginTop:24}}><h2>Thank you. We'll review this.</h2><p>While we review, you can make sure your restaurant's private draft has the right details. Your listing remains unpublished until the activation requirements are met.</p><button className="osm-btn" onClick={()=>navigate("/owner/claim")} data-testid="button-open-owner-draft">Open private draft</button></section>}
    <p className="osm-small">Already exchanged this invitation in this tab? <Link to="/owner/claim" data-testid="link-resume-claim">Open your owner workspace</Link>.</p>
  </div></main>;
}