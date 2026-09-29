import { useState, type FormEvent } from "react";

type Kind = "no_invitation" | "new_listing";

export default function OwnerListingRequest({ initialKind = "no_invitation" }: { initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const response = await fetch("/api/owner/listing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          restaurantName: fields.get("restaurantName"),
          city: fields.get("city"),
          address: fields.get("address"),
          contactName: fields.get("contactName"),
          businessEmail: fields.get("businessEmail"),
          website: fields.get("website"),
          note: fields.get("note"),
          companyFax: fields.get("companyFax"),
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Your request could not be sent.");
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your request could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="owner-request-title" className="rounded-2xl border border-[#e7dacf] bg-white p-6 md:p-8 shadow-sm" data-testid="owner-listing-request">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9b5b33]">No invitation needed to get in touch</p>
      <h2 id="owner-request-title" className="mt-2 text-2xl font-serif font-semibold text-[#2d211d]">Ask us about your restaurant</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#66594f]">Tell us about your venue. We’ll review your request and contact you about the next steps. Submitting this form does not claim or publish a listing; ownership must be verified first.</p>
      {sent ? <p role="status" className="mt-6 rounded-lg bg-[#edf6ef] p-4 text-[#235438]">Request received. Our team will review your details. No listing has been changed.</p> : (
        <form onSubmit={(event) => void submit(event)} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm font-semibold text-[#2d211d]">What do you need?
            <select className="mt-1 w-full rounded-lg border border-[#d9c9bb] bg-white p-3 text-[#2d211d]" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
              <option value="no_invitation">My restaurant is listed, but I don’t have an invitation</option>
              <option value="new_listing">I’d like to request a new restaurant listing</option>
            </select>
          </label>
          {([
            ["restaurantName", "Restaurant name", "text"],
            ["city", "Town or city", "text"],
            ["address", "Restaurant address", "text"],
            ["contactName", "Your name", "text"],
            ["businessEmail", "Business email", "email"],
            ["website", "Restaurant website (optional)", "url"],
          ] as const).map(([name, label, type]) => (
            <label key={name} className="text-sm font-semibold text-[#2d211d]">{label}
              <input className="mt-1 w-full rounded-lg border border-[#d9c9bb] bg-white p-3 text-[#2d211d]" name={name} type={type} required={name !== "website"} minLength={name === "address" ? 5 : undefined} maxLength={name === "website" ? 400 : 250} disabled={pending} />
            </label>
          ))}
          <label className="sm:col-span-2 text-sm font-semibold text-[#2d211d]">Anything else we should know? (optional)
            <textarea className="mt-1 w-full rounded-lg border border-[#d9c9bb] bg-white p-3 text-[#2d211d]" name="note" rows={3} maxLength={1000} disabled={pending} />
          </label>
          <div className="hidden" aria-hidden="true"><label>Company fax<input name="companyFax" tabIndex={-1} autoComplete="off" /></label></div>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={pending} className="sm:col-span-2 rounded-lg bg-[#2d211d] px-5 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Sending…" : "Send request for review"}</button>
        </form>
      )}
    </section>
  );
}