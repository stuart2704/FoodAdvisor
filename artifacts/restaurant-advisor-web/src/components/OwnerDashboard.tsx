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

interface RestaurantEvent {
  id: number;
  title: string;
  description: string;
  date: string;
  time: string;
  price: string;
}

interface EvidenceItem {
  value: string;
  evidenceUrl: string;
}

interface ChefProfile {
  name: string;
  bio: string;
  philosophy: string;
  signatureDishes: EvidenceItem[];
  awards: EvidenceItem[];
  photo: string;
  photoObjectPath?: string | null;
  moderationStatus?: "pending" | "approved" | "rejected";
  verifiedAt?: string | null;
  rejectionReason?: string | null;
}

interface BookingLink {
  url: string;
  provider: string;
}

const emptyChef: ChefProfile = {
  name: "",
  bio: "",
  philosophy: "",
  signatureDishes: [],
  awards: [],
  photo: "",
  photoObjectPath: null,
};
const CHEF_LIMITS = { name: 120, bio: 2000, philosophy: 1000, award: 240, dish: 180, evidence: 2048 };

const emptyOffer = {
  title: "",
  description: "",
  startDate: "",
  endDate: "",
};
const emptyEvent = {
  title: "",
  description: "",
  date: "",
  time: "",
  price: "",
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
  const [events, setEvents] = useState<RestaurantEvent[]>([]);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [eventError, setEventError] = useState("");
  const [chef, setChef] = useState<ChefProfile>(emptyChef);
  const [chefLoading, setChefLoading] = useState(true);
  const [chefSaving, setChefSaving] = useState(false);
  const [chefMessage, setChefMessage] = useState("");
  const [chefError, setChefError] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [booking, setBooking] = useState<BookingLink>({ url: "", provider: "" });
  const [bookingLoading, setBookingLoading] = useState(true);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingMessage, setBookingMessage] = useState("");
  const [bookingError, setBookingError] = useState("");

  const loadBooking = useCallback(async () => {
    setBookingLoading(true);
    setBookingError("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/booking`, {
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Booking link could not be loaded.");
      setBooking({
        url: typeof data.booking?.url === "string" ? data.booking.url : "",
        provider: typeof data.booking?.provider === "string" ? data.booking.provider : "",
      });
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Booking link could not be loaded.");
    } finally {
      setBookingLoading(false);
    }
  }, [token]);

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

  const loadEvents = useCallback(async () => {
    setEventLoading(true);
    setEventError("");
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(token)}/events`,
        { cache: "no-store", referrerPolicy: "no-referrer" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Events could not be loaded.");
      setEvents(data.events);
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Events could not be loaded.");
    } finally {
      setEventLoading(false);
    }
  }, [token]);

  const loadChef = useCallback(async () => {
    setChefLoading(true);
    setChefError("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/chef`, {
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Chef profile could not be loaded.");
      const value = data.chef ?? data;
      const normalizeItems = (items: unknown, evidence: unknown): EvidenceItem[] =>
        Array.isArray(items)
          ? items
              .slice(0, 12)
              .filter((item): item is string => typeof item === "string")
              .map((item, index) => ({
                value: item,
                evidenceUrl: Array.isArray(evidence) && typeof evidence[index] === "string" ? evidence[index] : "",
              }))
          : [];
      setChef({
        name: typeof value.name === "string" ? value.name : "",
        bio: typeof value.bio === "string" ? value.bio : "",
        philosophy: typeof value.philosophy === "string" ? value.philosophy : "",
        signatureDishes: normalizeItems(value.signatureDishes, value.dishEvidenceUrls),
        awards: normalizeItems(value.awards, value.awardEvidenceUrls),
        photo: typeof value.photoObjectPath === "string" ? `/api/portal/${encodeURIComponent(token)}/chef/photo` : "",
        photoObjectPath: typeof value.photoObjectPath === "string" ? value.photoObjectPath : null,
        moderationStatus: value.moderationStatus === "approved" || value.moderationStatus === "rejected" ? value.moderationStatus : "pending",
        verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : null,
        rejectionReason: typeof value.rejectionReason === "string" ? value.rejectionReason : null,
      });
    } catch (error) {
      setChefError(error instanceof Error ? error.message : "Chef profile could not be loaded.");
    } finally {
      setChefLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (verified) {
      void loadOffers();
      void loadEvents();
      void loadChef();
      void loadBooking();
    } else {
      setOfferLoading(false);
      setEventLoading(false);
      setBookingLoading(false);
    }
  }, [loadBooking, loadChef, loadEvents, loadOffers, verified]);

  async function saveBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBookingSaving(true);
    setBookingError("");
    setBookingMessage("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/booking`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify({
          url: booking.url,
          provider: booking.provider.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Booking link could not be saved.");
      setBooking({
        url: data.booking.url,
        provider: data.booking.provider ?? "",
      });
      setBookingMessage("Booking link approved and published.");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Booking link could not be saved.");
    } finally {
      setBookingSaving(false);
    }
  }

  async function removeBooking() {
    setBookingSaving(true);
    setBookingError("");
    setBookingMessage("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/booking`, {
        method: "DELETE",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Booking link could not be removed.");
      setBooking({ url: "", provider: "" });
      setBookingMessage("Booking link removed from your public profile.");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Booking link could not be removed.");
    } finally {
      setBookingSaving(false);
    }
  }

  function updateChef<K extends keyof ChefProfile>(key: K, value: ChefProfile[K]) {
    setChef((current) => ({ ...current, [key]: value }));
    setChefMessage("");
    setChefError("");
  }

  function updateChefItem(
    key: "signatureDishes" | "awards",
    index: number,
    field: keyof EvidenceItem,
    value: string,
  ) {
    setChef((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
  }

  function addChefItem(key: "signatureDishes" | "awards") {
    if (chef[key].length >= (key === "awards" ? 8 : 12)) return;
    updateChef(key, [...chef[key], { value: "", evidenceUrl: "" }]);
  }

  function removeChefItem(key: "signatureDishes" | "awards", index: number) {
    updateChef(key, chef[key].filter((_, itemIndex) => itemIndex !== index));
  }

  async function uploadChefPhoto(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setChefError("Chef photos must be JPEG, PNG, or WebP images.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setChefError("Chef photos must be 5 MiB or smaller.");
      return;
    }
    setPhotoUploading(true);
    setChefError("");
    try {
      const intentResponse = await fetch(`/api/portal/${encodeURIComponent(token)}/chef/photo/upload-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
      });
      const intent = await intentResponse.json();
      if (!intentResponse.ok || !intent.uploadUrl || intent.uploadMethod !== "PUT" || !intent.uploadHeaders) {
        throw new Error(intent.error || "Photo upload could not be started.");
      }
      const uploadResponse = await fetch(intent.uploadUrl, {
        method: intent.uploadMethod,
        headers: intent.uploadHeaders,
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Photo upload failed. Please try again.");
      const finalizeResponse = await fetch(`/api/portal/${encodeURIComponent(token)}/chef/photo/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPath: intent.objectPath, contentType: file.type, sizeBytes: file.size }),
      });
      const finalized = await finalizeResponse.json();
      if (!finalizeResponse.ok) throw new Error(finalized.error || "Photo could not be attached.");
      const finalizedChef = finalized.chef ?? finalized;
      updateChef("photo", typeof finalizedChef.photoObjectPath === "string" ? `/api/portal/${encodeURIComponent(token)}/chef/photo` : "");
      setChef((current) => ({ ...current, photoObjectPath: finalizedChef.photoObjectPath ?? null }));
      setRemovePhoto(false);
      setChefMessage("Photo uploaded. Save the profile to submit it for review.");
    } catch (error) {
      setChefError(error instanceof Error ? error.message : "Photo upload failed.");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function saveChef(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = [...chef.signatureDishes, ...chef.awards];
    if (!chef.name.trim() && !chef.bio.trim() && !chef.philosophy.trim() && items.length === 0 && !chef.photo) {
      setChefError("Add at least one chef detail before saving.");
      return;
    }
    if (items.some((item) => !item.value.trim() || !item.evidenceUrl.trim())) {
      setChefError("Every award and signature dish needs an attributable evidence URL.");
      return;
    }
    setChefSaving(true);
    setChefError("");
    setChefMessage("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/chef`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          name: chef.name.trim() || null,
          bio: chef.bio.trim() || null,
          philosophy: chef.philosophy.trim() || null,
          signatureDishes: chef.signatureDishes.map((item) => item.value.trim()),
          dishEvidenceUrls: chef.signatureDishes.map((item) => item.evidenceUrl.trim()),
          awards: chef.awards.map((item) => item.value.trim()),
          awardEvidenceUrls: chef.awards.map((item) => item.evidenceUrl.trim()),
          removePhoto,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Chef profile could not be saved.");
      const result = data.chef ?? data;
      setChef((current) => ({ ...current, moderationStatus: result.moderationStatus ?? "pending", verifiedAt: result.verifiedAt ?? null, rejectionReason: result.rejectionReason ?? null, photoObjectPath: removePhoto ? null : current.photoObjectPath, photo: removePhoto ? "" : current.photo }));
      setRemovePhoto(false);
      setChefMessage(result.moderationStatus === "approved" ? "Chef profile updated." : "Chef profile submitted for admin review.");
    } catch (error) {
      setChefError(error instanceof Error ? error.message : "Chef profile could not be saved.");
    } finally {
      setChefSaving(false);
    }
  }

  async function removeChef() {
    if (!window.confirm("Remove this chef profile from your listing?")) return;
    setChefSaving(true);
    setChefError("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/chef`, {
        method: "DELETE",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Chef profile could not be removed.");
      setChef(emptyChef);
      setChefMessage("Chef profile removed from review and the public listing.");
    } catch (error) {
      setChefError(error instanceof Error ? error.message : "Chef profile could not be removed.");
    } finally {
      setChefSaving(false);
    }
  }

  async function saveOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const publishing = editingOfferId === null;
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
      if (!response.ok || data.success !== true) throw new Error(data.error || "Offer could not be saved.");
      setOfferForm(emptyOffer);
      setEditingOfferId(null);
      setOfferMessage(publishing ? "Offer published." : "Offer updated.");
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
      if (!response.ok || data.success !== true) throw new Error(data.error || "Offer could not be deleted.");
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

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEventSaving(true);
    setEventError("");
    setEventMessage("");
    try {
      const isEditing = editingEventId !== null;
      const url = isEditing
        ? `/api/portal/${encodeURIComponent(token)}/events/${editingEventId}`
        : `/api/portal/${encodeURIComponent(token)}/events`;
      const response = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(eventForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Event could not be saved.");
      setEventForm(emptyEvent);
      setEditingEventId(null);
      setEventMessage(isEditing ? "Event updated." : "Event published.");
      await loadEvents();
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Event could not be saved.");
    } finally {
      setEventSaving(false);
    }
  }

  async function deleteEvent(id: number) {
    setEventError("");
    setEventMessage("");
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(token)}/events/${id}`,
        { method: "DELETE", cache: "no-store", referrerPolicy: "no-referrer" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Event could not be deleted.");
      if (editingEventId === id) {
        setEditingEventId(null);
        setEventForm(emptyEvent);
      }
      setEventMessage("Event deleted.");
      await loadEvents();
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Event could not be deleted.");
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
        <h2 className="text-2xl font-semibold">Booking link</h2>
        <p className="mt-2 text-muted-foreground">
          Add the HTTPS page where diners can book. We check the destination and its redirects before publishing it.
        </p>
        {bookingLoading ? <p className="mt-6">Loading booking link…</p> : (
          <form onSubmit={saveBooking} className="mt-6 grid gap-4">
            <label className="grid gap-1">
              <span className="font-medium">Booking URL</span>
              <input required type="url" maxLength={2048} placeholder="https://bookings.example.com/your-restaurant"
                value={booking.url} onChange={(event) => {
                  setBooking({ ...booking, url: event.target.value });
                  setBookingMessage("");
                  setBookingError("");
                }} className="rounded-lg border px-3 py-2" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Provider (optional)</span>
              <input maxLength={80} placeholder="OpenTable"
                value={booking.provider} onChange={(event) => setBooking({ ...booking, provider: event.target.value })}
                className="rounded-lg border px-3 py-2" />
            </label>
            {bookingMessage && <p className="text-sm text-green-700" role="status">{bookingMessage}</p>}
            {bookingError && <p className="text-sm text-red-700" role="alert">{bookingError}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={bookingSaving} className="rounded-lg bg-[#d94800] px-5 py-3 font-medium text-white disabled:opacity-60">
                {bookingSaving ? "Checking…" : "Check and publish"}
              </button>
              {booking.url && <button type="button" disabled={bookingSaving} onClick={() => void removeBooking()}
                className="rounded-lg border px-5 py-3 font-medium text-red-700 disabled:opacity-60">
                Remove booking link
              </button>}
            </div>
          </form>
        )}
      </div>}

      {verified && <div className="mt-10 rounded-2xl bg-white p-6">
        <h2 className="text-2xl font-semibold">Chef profile</h2>
        <p className="mt-2 text-muted-foreground">
          Share facts you can substantiate. Awards and signature dishes stay hidden until an administrator verifies them.
        </p>
        {chefLoading ? <p className="mt-6">Loading chef profile…</p> : <form onSubmit={saveChef} className="mt-6 grid gap-4">
          <label className="grid gap-1">
            <span className="font-medium">Chef name</span>
            <input maxLength={CHEF_LIMITS.name} value={chef.name} onChange={(event) => updateChef("name", event.target.value)} className="rounded-lg border px-3 py-2" />
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Biography</span>
            <textarea maxLength={CHEF_LIMITS.bio} rows={4} value={chef.bio} onChange={(event) => updateChef("bio", event.target.value)} className="rounded-lg border px-3 py-2" />
            <span className="text-xs text-muted-foreground">{chef.bio.length}/{CHEF_LIMITS.bio}</span>
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Cooking philosophy</span>
            <textarea maxLength={CHEF_LIMITS.philosophy} rows={3} value={chef.philosophy} onChange={(event) => updateChef("philosophy", event.target.value)} className="rounded-lg border px-3 py-2" />
          </label>
          {(["signatureDishes", "awards"] as const).map((key) => (
            <fieldset key={key} className="grid gap-3 rounded-xl border p-4">
              <legend className="px-1 font-semibold">{key === "awards" ? "Awards" : "Signature dishes"}</legend>
              <p className="text-sm text-muted-foreground">Each item needs a public source that helps our team verify it.</p>
              {chef[key].map((item, index) => (
                <div key={`${key}-${index}`} className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <input required maxLength={key === "awards" ? CHEF_LIMITS.award : CHEF_LIMITS.dish} aria-label={`${key === "awards" ? "Award" : "Signature dish"} ${index + 1}`} placeholder={key === "awards" ? "Award or recognition" : "Dish name"} value={item.value} onChange={(event) => updateChefItem(key, index, "value", event.target.value)} className="rounded-lg border px-3 py-2" />
                  <input required type="url" maxLength={CHEF_LIMITS.evidence} aria-label="Evidence URL" placeholder="Evidence URL (https://…)" value={item.evidenceUrl} onChange={(event) => updateChefItem(key, index, "evidenceUrl", event.target.value)} className="rounded-lg border px-3 py-2" />
                  <button type="button" onClick={() => removeChefItem(key, index)} className="rounded-lg border px-3 py-2 text-red-700">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => addChefItem(key)} disabled={chef[key].length >= (key === "awards" ? 8 : 12)} className="w-fit rounded-lg border px-4 py-2 font-medium disabled:opacity-50">
                Add {key === "awards" ? "award" : "dish"}
              </button>
            </fieldset>
          ))}
          <div className="grid gap-2">
            <label htmlFor="chef-photo" className="font-medium">Chef photo</label>
            <input id="chef-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={photoUploading} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadChefPhoto(file);
              event.currentTarget.value = "";
            }} />
            <span className="text-xs text-muted-foreground">JPEG, PNG, or WebP, up to 5 MiB.</span>
            {chef.photo && !removePhoto && <div className="flex items-center gap-3">
              <img src={chef.photo} alt="Current chef profile" className="h-20 w-20 rounded-xl object-cover" />
              <button type="button" onClick={() => { setRemovePhoto(true); setChefMessage("Photo removal will take effect when you save the profile."); }} className="text-sm font-medium text-red-700">Remove photo</button>
            </div>}
            {removePhoto && <p className="text-sm text-muted-foreground">Photo marked for removal. Save the profile to apply this change.</p>}
          </div>
          {chef.moderationStatus && <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm" role="status">
            Status: <strong>{chef.moderationStatus}</strong>. {chef.moderationStatus === "pending" ? "An administrator must review changes before they appear publicly." : chef.moderationStatus === "rejected" ? "Please correct the details and resubmit." : "This profile is approved for public display."}
          </p>}
          {chef.rejectionReason && <p className="text-sm text-red-700" role="alert">Review feedback: {chef.rejectionReason}</p>}
          {chefMessage && <p className="text-sm text-green-700" role="status">{chefMessage}</p>}
          {chefError && <p className="text-sm text-red-700" role="alert">{chefError}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={chefSaving || photoUploading} className="rounded-lg bg-[#d94800] px-5 py-3 font-medium text-white disabled:opacity-60">
              {chefSaving ? "Saving…" : "Save chef profile"}
            </button>
            {(chef.name || chef.bio || chef.philosophy || chef.photo || chef.signatureDishes.length || chef.awards.length) ? <button type="button" disabled={chefSaving} onClick={() => void removeChef()} className="rounded-lg border px-5 py-3 font-medium text-red-700">Remove profile</button> : null}
          </div>
        </form>}
      </div>}

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

      {verified && <div className="mt-10 rounded-2xl bg-white p-6">
        <h2 className="text-2xl font-semibold">Upcoming events</h2>
        <p className="mt-2 text-muted-foreground">
          Publish events to your verified restaurant profile. Past events are hidden automatically.
        </p>
        <form onSubmit={saveEvent} className="mt-6 grid gap-4">
          <label className="grid gap-1">
            <span className="font-medium">Title</span>
            <input required maxLength={120} value={eventForm.title}
              onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })}
              className="rounded-lg border px-3 py-2" />
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Description</span>
            <textarea required maxLength={1000} rows={4} value={eventForm.description}
              onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })}
              className="rounded-lg border px-3 py-2" />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-1">
              <span className="font-medium">Date</span>
              <input required type="date" min={new Date().toISOString().slice(0, 10)}
                value={eventForm.date}
                onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })}
                className="rounded-lg border px-3 py-2" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Time</span>
              <input required type="time" value={eventForm.time}
                onChange={(event) => setEventForm({ ...eventForm, time: event.target.value })}
                className="rounded-lg border px-3 py-2" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Price</span>
              <input required maxLength={40} placeholder="Free or £25.00"
                value={eventForm.price}
                onChange={(event) => setEventForm({ ...eventForm, price: event.target.value })}
                className="rounded-lg border px-3 py-2" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={eventSaving}
              className="rounded-lg bg-[#d94800] px-5 py-3 font-medium text-white disabled:opacity-60">
              {eventSaving ? "Saving…" : editingEventId === null ? "Publish event" : "Save changes"}
            </button>
            {editingEventId !== null && (
              <button type="button" onClick={() => {
                setEditingEventId(null);
                setEventForm(emptyEvent);
              }} className="rounded-lg border px-5 py-3 font-medium">Cancel</button>
            )}
          </div>
        </form>
        {eventMessage && <p className="mt-4 text-sm text-green-700" role="status">{eventMessage}</p>}
        {eventError && <p className="mt-4 text-sm text-red-700" role="alert">{eventError}</p>}
        <div className="mt-8 grid gap-3">
          {eventLoading && <p>Loading events…</p>}
          {!eventLoading && events.length === 0 && <p className="text-muted-foreground">No upcoming events.</p>}
          {events.map((event) => (
            <article key={event.id} className="rounded-xl border p-4">
              <h3 className="font-semibold">{event.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
              <p className="mt-2 text-sm">{event.date} at {event.time} · {event.price}</p>
              <div className="mt-3 flex gap-3">
                <button type="button" className="font-medium text-[#b83d00]" onClick={() => {
                  setEditingEventId(event.id);
                  setEventForm({
                    title: event.title,
                    description: event.description,
                    date: event.date,
                    time: event.time,
                    price: event.price,
                  });
                  setEventMessage("");
                  setEventError("");
                }}>Edit</button>
                <button type="button" className="font-medium text-red-700"
                  onClick={() => void deleteEvent(event.id)}>Delete</button>
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