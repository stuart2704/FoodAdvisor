import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getGetOsmOwnerDashboardQueryKey, getGetOsmOwnerAnalyticsQueryKey, useGetOsmOwnerDashboard, useGetOsmOwnerAnalytics, useUpdateOsmOwnerDraft, useActivateOsmOwnerListing, useSetOsmOwnerOutreachPreference } from "@workspace/api-client-react";
import type { OsmOwnerDraft, OsmOwnerDraftInput } from "@workspace/api-client-react";
import { clearOwnerSession, isUnauthorized, ownerRequest, ownerSession, readableError } from "./osm-shared";
import "./osm-workflow.css";

function Analytics({ active, onUnauthorized }: {active:boolean;onUnauthorized:()=>void}) {
  const query = useGetOsmOwnerAnalytics({request:ownerRequest(),query:{enabled:active,queryKey:getGetOsmOwnerAnalyticsQueryKey()}});
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  useEffect(()=>{if(query.isError && isUnauthorized(query.error)) onUnauthorizedRef.current();},[query.isError,query.error]);
  if (!active) return null;
  return <section className="osm-card"><h2>Listing activity</h2><p className="osm-small">Last 30 days</p>{query.isLoading ? <div className="osm-skeleton"/> : query.isError ? <div className="osm-error">Analytics are unavailable. <button className="osm-btn quiet" onClick={()=>void query.refetch()} data-testid="button-retry-analytics">Retry</button></div> : <div className="osm-progress" data-testid="status-owner-analytics"><span>Views · {query.data?.last30Days.views.toLocaleString()}</span><span>Searches · {query.data?.last30Days.searches.toLocaleString()}</span><span>Clicks · {query.data?.last30Days.clicks.toLocaleString()}</span></div>}</section>;
}

function DraftEditor({draft, onSaved}:{draft:OsmOwnerDraft;onSaved:()=>void}) {
  const [form,setForm] = useState<OsmOwnerDraftInput>(()=>({...draft}));
  const [lat,setLat] = useState(draft.latitude?.toString() ?? "");
  const [lng,setLng] = useState(draft.longitude?.toString() ?? "");
  const [hours,setHours] = useState(draft.openingHours.join("\n"));
  const [error,setError] = useState("");
  const [saved,setSaved] = useState(false);
  const update = useUpdateOsmOwnerDraft({request:ownerRequest()});
  function field(key:keyof OsmOwnerDraftInput, value:string) {setForm(prev=>({...prev,[key]:value}));setSaved(false);}
  return <section className="osm-card"><span className="osm-eyebrow">Private listing draft</span><h2>Business details</h2><p className="osm-small">Make sure diners will find accurate information. Your changes are saved privately until activation.</p>
    <form onSubmit={e=>{e.preventDefault();setError(""); const latitude=lat.trim()?Number(lat):null,longitude=lng.trim()?Number(lng):null;if ((latitude!==null&&(!Number.isFinite(latitude)||latitude < -90||latitude > 90))||(longitude!==null&&(!Number.isFinite(longitude)||longitude < -180||longitude > 180))) {setError("Enter valid latitude (−90 to 90) and longitude (−180 to 180).");return;} update.mutate({data:{...form,openingHours:hours.split("\n").map(s=>s.trim()).filter(Boolean),latitude,longitude}},{onSuccess:()=>{setSaved(true);onSaved();},onError:err=>{if(isUnauthorized(err))clearOwnerSession();setError(readableError(err));}});}}>
      <div className="osm-fields">
        <label className="osm-field">Restaurant name<input required maxLength={300} value={form.name??""} onChange={e=>field("name",e.target.value)} data-testid="input-draft-name"/></label>
        <label className="osm-field">City<input maxLength={200} value={form.city??""} onChange={e=>field("city",e.target.value)} data-testid="input-draft-city"/></label>
        <label className="osm-field wide">Street address<input maxLength={1000} value={form.address??""} onChange={e=>field("address",e.target.value)} data-testid="input-draft-address"/></label>
        <label className="osm-field">Phone<input type="tel" maxLength={100} value={form.phone??""} onChange={e=>field("phone",e.target.value)} data-testid="input-draft-phone"/></label>
        <label className="osm-field">Website<input type="url" maxLength={2048} value={form.website??""} onChange={e=>field("website",e.target.value)} data-testid="input-draft-website"/></label>
        <label className="osm-field wide">About the restaurant<textarea maxLength={4000} value={form.description??""} onChange={e=>field("description",e.target.value)} data-testid="input-draft-description"/></label>
        <label className="osm-field wide">Opening hours · one line per day, up to 14 lines<textarea value={hours} onChange={e=>{setHours(e.target.value);setSaved(false);}} placeholder={"Monday 11:00–21:00\nTuesday 11:00–21:00"} data-testid="input-draft-hours"/></label>
        <label className="osm-field">Map latitude<input type="number" step="any" min="-90" max="90" value={lat} onChange={e=>{setLat(e.target.value);setSaved(false);}} data-testid="input-draft-latitude"/></label>
        <label className="osm-field">Map longitude<input type="number" step="any" min="-180" max="180" value={lng} onChange={e=>{setLng(e.target.value);setSaved(false);}} data-testid="input-draft-longitude"/></label>
      </div>
      {error && <div className="osm-error" role="alert">{error}</div>}{saved && <div className="osm-success" role="status">Private draft saved.</div>}
      <button className="osm-btn" disabled={update.isPending||hours.split("\n").filter(Boolean).length>14||hours.split("\n").some(s=>s.length>200)} type="submit" data-testid="button-save-draft">{update.isPending?"Saving…":"Save draft"}</button>
      {hours.split("\n").filter(Boolean).length>14 && <p className="osm-error">Use no more than 14 opening-hours lines.</p>}
    </form>
  </section>;
}

export default function OsmOwnerPage() {
  const client=useQueryClient();
  const [session,setSession]=useState(()=>ownerSession());
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const dashboard=useGetOsmOwnerDashboard({request:ownerRequest(),query:{enabled:!!session,queryKey:getGetOsmOwnerDashboardQueryKey(),retry:false}});
  const activate=useActivateOsmOwnerListing({request:ownerRequest()});
  const preference=useSetOsmOwnerOutreachPreference({request:ownerRequest()});
  useEffect(()=>{if(dashboard.isError&&isUnauthorized(dashboard.error)){clearOwnerSession();setSession(null);client.removeQueries({queryKey:getGetOsmOwnerDashboardQueryKey()});}},[dashboard.isError,dashboard.error,client]);
  function fail(e:unknown){if(isUnauthorized(e)){clearOwnerSession();setSession(null);}setError(readableError(e));}
  const data=dashboard.data;
  return <main className="osm-page"><div className="osm-wrap">
    <div className="osm-top"><div><span className="osm-eyebrow">The Food Advisor / Owner workspace</span><h1>{data?.candidate.name || "Your restaurant workspace"}</h1><p className="osm-intro">{data?.dashboardMode==="activated" ? "Your listing is activated. Keep your information current and see how diners find you." : "Build an accurate listing while our team reviews your evidence. Your private draft is not visible to diners."}</p></div>{session && <button className="osm-btn quiet" onClick={()=>{clearOwnerSession();setSession(null);client.removeQueries({queryKey:getGetOsmOwnerDashboardQueryKey()});client.removeQueries({queryKey:getGetOsmOwnerAnalyticsQueryKey()});}} data-testid="button-end-owner-session">End session</button>}</div>
    {!session ? <section className="osm-card"><h2>Open your secure invitation</h2><p>Your owner session is only available in the tab where you exchanged the invitation. Reopen a valid invitation link in this tab to continue. An expired link needs to be reissued.</p><Link to="/owner" className="osm-btn quiet" data-testid="link-owner-help">Owner information</Link></section> :
    dashboard.isLoading ? <section className="osm-card"><div className="osm-skeleton"/><div className="osm-skeleton"/><div className="osm-skeleton"/></section> :
    dashboard.isError ? <section className="osm-card"><div className="osm-error" role="alert">We could not load your private workspace. <button className="osm-btn quiet" onClick={()=>void dashboard.refetch()} data-testid="button-retry-owner">Try again</button></div></section> :
    data && <>
      {notice && <div className="osm-success" role="status" data-testid="status-owner-notice">{notice}</div>}{error && <div className="osm-error" role="alert" data-testid="status-owner-error">{error}</div>}
      <div className="osm-split"><div>
        <section className="osm-card"><span className="osm-eyebrow">{data.dashboardMode==="activated"?"Activated listing":"Before activation"}</span><h2>Where things stand</h2><div className="osm-progress"><span className={data.candidate.identityVerified?"done":""}>Email verified</span><span className={data.evidence.ownershipStatus==="approved"?"done":""}>Ownership: {data.evidence.ownershipStatus.replaceAll("_"," ")}</span><span className={data.evidence.rightsStatus==="approved"?"done":""}>Source rights: {data.evidence.rightsStatus.replaceAll("_"," ")}</span><span className={data.draft.requiredFieldsComplete?"done":""}>Details complete</span><span className={data.activation.published?"done":""}>Published</span></div>
        {data.dashboardMode==="pre_activation" && <><div className="osm-note">Email access alone does not establish business ownership. Both evidence decisions and required listing details must be complete before activation.</div><button className="osm-btn" disabled={activate.isPending||!data.candidate.identityVerified||data.evidence.ownershipStatus!=="approved"||data.evidence.rightsStatus!=="approved"||!data.draft.requiredFieldsComplete} onClick={()=>{setError("");setNotice("");activate.mutate(undefined,{onSuccess:()=>{setNotice("Activation requested. Check the progress below.");void client.invalidateQueries({queryKey:getGetOsmOwnerDashboardQueryKey()});},onError:fail});}} data-testid="button-activate-owner">{activate.isPending?"Activating…":"Activate listing"}</button></>}
        {data.activation.currentStep && <p className="osm-small">Activation step: {data.activation.currentStep}</p>}{data.activation.errors.map((e,i)=><p key={i} className="osm-error" role="alert">{e.step}: {e.errorCode}</p>)}
        </section>
        <DraftEditor key={data.candidate.sourceId} draft={data.draft} onSaved={()=>void client.invalidateQueries({queryKey:getGetOsmOwnerDashboardQueryKey()})}/>
      </div><aside>
        <Analytics active={data.dashboardMode==="activated"} onUnauthorized={()=>{clearOwnerSession();setSession(null);client.removeQueries({queryKey:getGetOsmOwnerAnalyticsQueryKey()});}}/>
        <section className="osm-card"><h2>Outreach preferences</h2><p className="osm-small">Control whether we contact you about this listing. Changes are saved to your owner account.</p><div className="osm-actions"><button className="osm-btn quiet" disabled={preference.isPending} onClick={()=>{setError("");preference.mutate({data:{disabled:true}},{onSuccess:()=>setNotice("Outreach disabled."),onError:fail});}} data-testid="button-disable-outreach">Pause outreach</button><button className="osm-btn quiet" disabled={preference.isPending} onClick={()=>{setError("");preference.mutate({data:{disabled:false}},{onSuccess:()=>setNotice("Outreach enabled."),onError:fail});}} data-testid="button-enable-outreach">Allow outreach</button></div></section>
        <section className="osm-card"><h2>More for your listing</h2><ul className="osm-list"><li><strong>Menus & photos</strong><br/><span className="osm-small">Uploads are not available for this claim workflow yet. No files are sent from this workspace.</span></li><li><strong>Premium</strong><br/><span className="osm-small">A secure checkout will be available when an eligible portal checkout is linked to this claimed listing. No plan changes are made here.</span></li></ul></section>
      </aside></div>
    </>}
  </div></main>;
}