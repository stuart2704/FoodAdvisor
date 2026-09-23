import { useCallback, useEffect, useState, type FormEvent } from "react";

interface OwnerDashboardProps {
  token: string;
  restaurantName: string;
  verified: boolean;
}

interface Offer {
  id: number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
}

const emptyOffer = {
  title: "",
  description: "",
  startDate: "",
  endDate: "",
};

export default function OwnerDashboard({
  token,
  restaurantName,
  verified,
}: OwnerDashboardProps) {
  const [seoText, setSeoText] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialPosts, setSocialPosts] = useState("");
  const [tone, setTone] = useState("friendly");
  const [loadingSocial, setLoadingSocial] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerForm, setOfferForm] = useState(emptyOffer);
  const [editingOfferId, setEditingOfferId] = useState<number | null>(null);
  const [offerLoading, setOfferLoading] = useState(true);
  const [offerSaving, setOfferSaving] = useState(false);
  const [offerMessage, setOfferMessage] = useState("");
  const [offerError, setOfferError] = useState("");

  const loadOffers = useCallback(async () => {
    setOfferLoading(true);
    setOfferError("");
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(token)}/offers`,
        { cache: "no-store", referrerPolicy: "no-referrer" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Offers could not be loaded.");
      setOffers(data.offers);
    } catch (error) {
      setOfferError(error instanceof Error ? error.message : "Offers could not be loaded.");
    } finally {
      setOfferLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (verified) void loadOffers();
    else setOfferLoading(false);
  }, [loadOffers, verified]);

  async function saveOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOfferSaving(true);
    setOfferError("");
    setOfferMessage("");
    try {
      const url = editingOfferId === null
        ? `/api/portal/${encodeURIComponent(token)}/offers`
        : `/api/portal/${encodeURIComponent(token)}/offers/${editingOfferId}`;
      const response = await fetch(url, {
        method: editingOfferId === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(offerForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Offer could not be saved.");
      setOfferForm(emptyOffer);
      setEditingOfferId(null);
      setOfferMessage(editingOfferId === null ? "Offer published." : "Offer updated.");
      await loadOffers();
    } catch (error) {
      setOfferError(error instanceof Error ? error.message : "Offer could not be saved.");
    } finally {
      setOfferSaving(false);
    }
  }

  async function deleteOffer(id: number) {
    setOfferError("");
    setOfferMessage("");
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(token)}/offers/${id}`,
        { method: "DELETE", cache: "no-store", referrerPolicy: "no-referrer" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Offer could not be deleted.");
      if (editingOfferId === id) {
        setEditingOfferId(null);
        setOfferForm(emptyOffer);
      }
      setOfferMessage("Offer deleted.");
      await loadOffers();
    } catch (error) {
      setOfferError(error instanceof Error ? error.message : "Offer could not be deleted.");
    }
  }

  function generateSEO() {
    setLoading(true);

    fetch(`/api/portal/${encodeURIComponent(token)}/marketing/seo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({})
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "SEO text could not be generated.");
        }
        return data;
      })
      .then(data => setSeoText(data.seo))
      .catch(() => setSeoText("SEO text could not be generated right now."))
      .finally(() => setLoading(false));
  }

  function generateSocial() {
    setLoadingSocial(true);
    setSocialPosts("");

    fetch(`/api/portal/${encodeURIComponent(token)}/marketing/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ tone })
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Social posts could not be generated.");
        }
        return data;
      })
      .then(data => setSocialPosts(data.posts))
      .catch(() =>
        setSocialPosts("Social posts could not be generated right now.")
      )
      .finally(() => setLoadingSocial(false));
  }

  return (
    <div className="section">
      <h2 className="font-serif text-3xl font-semibold">Marketing tools</h2>
      <p className="mt-2 text-muted-foreground">
        Generate content using the verified listing for {restaurantName}.
      </p>

      {verified && <div className="mt-10 rounded-2xl bg-white p-6">
        <h2 className="text-2xl font-semibold">Time-limited offers</h2>
        <p className="mt-2 text-muted-foreground">
          Publish a promotion to your verified restaurant profile. Expired offers are hidden automatically.
        </p>

        <form onSubmit={saveOffer} className="mt-6 grid gap-4">
          <label className="grid gap-1">
            <span className="font-medium">Title</span>
            <input
              required
              maxLength={120}
              value={offerForm.title}
              onChange={(event) => setOfferForm({ ...offerForm, title: event.target.value })}
              className="rounded-lg border px-3 py-2"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Description</span>
            <textarea
              required
              maxLength={1000}
              rows={4}
              value={offerForm.description}
              onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })}
              className="rounded-lg border px-3 py-2"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="font-medium">Start date</span>
              <input
                required
                type="date"
                value={offerForm.startDate}
                onChange={(event) => setOfferForm({ ...offerForm, startDate: event.target.value })}
                className="rounded-lg border px-3 py-2"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">End date</span>
              <input
                required
                type="date"
                min={offerForm.startDate || new Date().toISOString().slice(0, 10)}
                value={offerForm.endDate}
                onChange={(event) => setOfferForm({ ...offerForm, endDate: event.target.value })}
                className="rounded-lg border px-3 py-2"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={offerSaving}
              className="rounded-lg bg-[#d94800] px-5 py-3 font-medium text-white disabled:opacity-60"
            >
              {offerSaving ? "Saving…" : editingOfferId === null ? "Publish offer" : "Save changes"}
            </button>
            {editingOfferId !== null && (
              <button
                type="button"
                onClick={() => {
                  setEditingOfferId(null);
                  setOfferForm(emptyOffer);
                }}
                className="rounded-lg border px-5 py-3 font-medium"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {offerMessage && <p className="mt-4 text-sm text-green-700" role="status">{offerMessage}</p>}
        {offerError && <p className="mt-4 text-sm text-red-700" role="alert">{offerError}</p>}

        <div className="mt-8 grid gap-3">
          {offerLoading && <p>Loading offers…</p>}
          {!offerLoading && offers.length === 0 && <p className="text-muted-foreground">No current or upcoming offers.</p>}
          {offers.map((offer) => (
            <article key={offer.id} className="rounded-xl border p-4">
              <h3 className="font-semibold">{offer.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{offer.description}</p>
              <p className="mt-2 text-sm">{offer.startDate} to {offer.endDate}</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  className="font-medium text-[#b83d00]"
                  onClick={() => {
                    setEditingOfferId(offer.id);
                    setOfferForm({
                      title: offer.title,
                      description: offer.description,
                      startDate: offer.startDate,
                      endDate: offer.endDate,
                    });
                    setOfferMessage("");
                    setOfferError("");
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="font-medium text-red-700"
                  onClick={() => void deleteOffer(offer.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>}

      <div
        style={{
          marginTop: "40px",
          background: "#fff",
          padding: "24px",
          borderRadius: "16px"
        }}
      >
        <h2>AI‑Generated SEO Text</h2>
        <p>Boost your visibility on Google with AI‑optimised content.</p>

        <button
          onClick={generateSEO}
          disabled={loading}
          style={{
            padding: "12px 20px",
            background: "#d94800",
            color: "#fff",
            borderRadius: "8px",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            marginTop: "12px",
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Generating…" : "Generate SEO Text"}
        </button>

        {seoText && (
          <div
            style={{
              marginTop: "24px",
              whiteSpace: "pre-wrap",
              lineHeight: "1.6"
            }}
          >
            {seoText}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: "40px",
          background: "#fff",
          padding: "24px",
          borderRadius: "16px"
        }}
      >
        <h2>AI Social Media Posts</h2>
        <p>Generate ready-to-post content for Instagram, Facebook, and TikTok.</p>

        <label style={{ display: "block", marginTop: "12px" }}>
          Tone:
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            style={{
              marginLeft: "12px",
              padding: "8px",
              borderRadius: "8px",
              border: "1px solid #ccc"
            }}
          >
            <option value="friendly">Friendly</option>
            <option value="luxury">Luxury</option>
            <option value="fun">Fun</option>
            <option value="romantic">Romantic</option>
            <option value="professional">Professional</option>
          </select>
        </label>

        <button
          onClick={generateSocial}
          disabled={loadingSocial}
          style={{
            padding: "12px 20px",
            background: "#d94800",
            color: "#fff",
            borderRadius: "8px",
            border: "none",
            cursor: loadingSocial ? "wait" : "pointer",
            marginTop: "12px",
            opacity: loadingSocial ? 0.7 : 1
          }}
        >
          {loadingSocial ? "Generating…" : "Generate Social Posts"}
        </button>

        {socialPosts && (
          <div
            style={{
              marginTop: "24px",
              whiteSpace: "pre-wrap",
              lineHeight: "1.6"
            }}
          >
            {socialPosts}
          </div>
        )}
      </div>
    </div>
  );
}