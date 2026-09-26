import { useAuth, useClerk } from "@clerk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2, X } from "lucide-react";
import "./collection-management.css";

type Restaurant = {
  membershipId?: string;
  id: string;
  name: string;
  city: string;
  slug?: string;
  cuisine?: string | null;
  rating?: number | null;
  premium?: boolean;
};
type Collection = {
  id: string;
  title: string;
  description: string;
  city: string;
  curatorUserId: string;
  updatedAt: string;
  restaurants: Restaurant[];
};
type City = { city: string; slug: string; count: number };
type Draft = { title: string; description: string; city: string; restaurantIds: string[] };
type Feedback = { kind: "error" | "success"; text: string } | null;

const blankDraft = (): Draft => ({ title: "", description: "", city: "", restaurantIds: [] });
const fromCollection = (item: Collection): Draft => ({
  title: item.title,
  description: item.description,
  city: item.city,
  restaurantIds: item.restaurants.map((restaurant) => restaurant.id),
});
const sameIds = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export default function CollectionManagementPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { openSignIn } = useClerk();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [available, setAvailable] = useState<Restaurant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [loading, setLoading] = useState(true);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [citiesError, setCitiesError] = useState("");
  const [availableError, setAvailableError] = useState("");
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState<"details" | "lineup" | "delete" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [lineupFeedback, setLineupFeedback] = useState<Feedback>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState("");
  const [restaurantRetry, setRestaurantRetry] = useState(0);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    if (isSignedIn) {
      try {
        const token = await getToken();
        if (token) headers.set("Authorization", `Bearer ${token}`);
      } catch {
        // A valid administrator cookie may still authorize this request.
      }
    }
    const response = await fetch(path, { ...options, headers, credentials: "include", cache: "no-store" });
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => null) as
      | { success?: boolean; data?: T; error?: string; message?: string }
      | T
      | null;
    if (!response.ok || (payload && typeof payload === "object" && "success" in payload && payload.success === false)) {
      const message = payload && typeof payload === "object"
        ? ("error" in payload && payload.error) || ("message" in payload && payload.message)
        : null;
      throw new RequestError(String(message || `Request failed (${response.status}). Please try again.`), response.status);
    }
    if (payload && typeof payload === "object" && "success" in payload) {
      if (!("data" in payload)) throw new RequestError("The server returned an incomplete response.", response.status);
      return payload.data as T;
    }
    return payload as T;
  }, [getToken, isSignedIn]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof RequestError && (error.status === 403 || error.status === 401)) {
      setDenied(true);
      return "Your session cannot access this workspace. Sign in again to continue.";
    }
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  }, []);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const result = await request<Collection[]>("/api/collections/manage");
      if (!Array.isArray(result)) throw new Error("The collections response was not in the expected format.");
      setCollections(result);
      const active = result.find((item) => item.id === selectedIdRef.current);
      if (selectedIdRef.current === "__new__") return;
      const next = active ?? result[0];
      setSelectedId(next?.id ?? null);
      setDraft(next ? fromCollection(next) : blankDraft());
      setFeedback(null);
      setLineupFeedback(null);
    } catch (error) {
      setListError(handleError(error));
    } finally {
      setLoading(false);
    }
  }, [request, handleError]);

  const loadCities = useCallback(async () => {
    setCitiesLoading(true);
    setCitiesError("");
    try {
      const result = await request<City[]>("/api/cities");
      if (!Array.isArray(result)) throw new Error("The cities response was not in the expected format.");
      setCities(result);
    } catch (error) {
      setCitiesError(handleError(error));
    } finally {
      setCitiesLoading(false);
    }
  }, [request, handleError]);

  useEffect(() => {
    document.title = "Manage city highlights | The Food Advisor";
  }, []);
  useEffect(() => {
    if (!isLoaded) return;
    void loadCollections();
    void loadCities();
  }, [isLoaded, loadCollections, loadCities]);
  useEffect(() => {
    if (!isLoaded || denied || !draft.city) {
      setAvailable([]);
      setAvailableError("");
      return;
    }
    const controller = new AbortController();
    setAvailable([]);
    setAvailableLoading(true);
    setAvailableError("");
    void request<Restaurant[]>(
      `/api/collections/manage/restaurants?city=${encodeURIComponent(draft.city)}`,
      { signal: controller.signal },
    ).then((result) => {
      if (!controller.signal.aborted) {
        if (!Array.isArray(result)) throw new Error("The restaurant list was not in the expected format.");
        setAvailable(result);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setAvailableError(handleError(error));
    }).finally(() => {
      if (!controller.signal.aborted) setAvailableLoading(false);
    });
    return () => controller.abort();
  }, [draft.city, isLoaded, denied, restaurantRetry, request, handleError]);

  const selected = collections.find((item) => item.id === selectedId);
  const isNew = selectedId === "__new__";
  const cityChanged = Boolean(selected && draft.city !== selected.city);
  const detailsDirty = isNew || Boolean(selected &&
    (draft.title !== selected.title || draft.description !== selected.description || cityChanged));
  const lineupDirty = isNew
    ? draft.restaurantIds.length > 0
    : Boolean(selected && !sameIds(draft.restaurantIds, selected.restaurants.map((item) => item.id)));
  const restaurantById = useMemo(() => {
    const entries = [...(selected?.restaurants ?? []), ...available];
    return new Map(entries.map((restaurant) => [restaurant.id, restaurant]));
  }, [available, selected]);
  const filteredAvailable = available.filter((restaurant) =>
    !draft.restaurantIds.includes(restaurant.id) &&
    restaurant.name.toLowerCase().includes(search.trim().toLowerCase()));

  function choose(id: string | null) {
    if (saving) return;
    if (selectedId === id) return;
    if ((detailsDirty || lineupDirty) && !window.confirm("Discard your unsaved changes?")) return;
    const next = collections.find((item) => item.id === id);
    setSelectedId(id);
    setDraft(next ? fromCollection(next) : blankDraft());
    setFeedback(null);
    setLineupFeedback(null);
    setSearch("");
  }

  function refreshCollections() {
    if (saving || ((detailsDirty || lineupDirty) && !window.confirm("Discard your unsaved changes and refresh?"))) return;
    void loadCollections();
  }

  function updateCity(city: string) {
    if (city === draft.city) return;
    setDraft((old) => ({ ...old, city, restaurantIds: [] }));
    setSearch("");
    setFeedback(null);
    setLineupFeedback(null);
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title || !description || !draft.city || draft.restaurantIds.length === 0) {
      setFeedback({ kind: "error", text: "Add a title, description, city, and at least one restaurant before saving." });
      return;
    }
    setSaving("details");
    setFeedback(null);
    try {
      if (isNew) {
        const created = await request<Collection>("/api/collections", {
          method: "POST",
          body: JSON.stringify({ title, description, city: draft.city, restaurantIds: draft.restaurantIds }),
        });
        setCollections((old) => [created, ...old]);
        setSelectedId(created.id);
        setDraft(fromCollection(created));
        setFeedback({ kind: "success", text: "Collection created. It is now in your editorial list." });
        setLineupFeedback(null);
      } else if (selected) {
        const updated = await request<Collection>(`/api/collections/${encodeURIComponent(selected.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            description,
            city: draft.city,
            ...(cityChanged ? { restaurantIds: draft.restaurantIds } : {}),
          }),
        });
        setCollections((old) => old.map((item) => item.id === updated.id ? updated : item));
        setDraft((old) => ({ ...old, title: updated.title, description: updated.description, city: updated.city, restaurantIds: old.restaurantIds }));
        setFeedback({
          kind: "success",
          text: cityChanged ? "City and its new restaurant lineup saved." : "Collection details saved.",
        });
        if (cityChanged) setLineupFeedback(null);
      }
    } catch (error) {
      setFeedback({ kind: "error", text: handleError(error) });
    } finally {
      setSaving(null);
    }
  }

  async function saveLineup() {
    if (!selected || saving || cityChanged) return;
    setSaving("lineup");
    setLineupFeedback(null);
    try {
      const updated = await request<Collection>(`/api/collections/${encodeURIComponent(selected.id)}/restaurants`, {
        method: "PUT",
        body: JSON.stringify({ restaurantIds: draft.restaurantIds }),
      });
      setCollections((old) => old.map((item) => item.id === updated.id ? updated : item));
      setDraft((old) => ({ ...old, restaurantIds: updated.restaurants.map((item) => item.id) }));
      setLineupFeedback({ kind: "success", text: "Restaurant selection and order saved." });
    } catch (error) {
      setLineupFeedback({ kind: "error", text: handleError(error) });
    } finally {
      setSaving(null);
    }
  }

  async function deleteCollection() {
    if (!selected || saving) return;
    setSaving("delete");
    setFeedback(null);
    try {
      await request<void>(`/api/collections/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const remaining = collections.filter((item) => item.id !== selected.id);
      setCollections(remaining);
      const next = remaining[0];
      setSelectedId(next?.id ?? null);
      setDraft(next ? fromCollection(next) : blankDraft());
      setConfirmDelete(false);
      setFeedback({ kind: "success", text: `“${selected.title}” was deleted.` });
      setLineupFeedback(null);
    } catch (error) {
      setFeedback({ kind: "error", text: handleError(error) });
      setConfirmDelete(false);
    } finally {
      setSaving(null);
    }
  }

  function moveRestaurant(index: number, direction: -1 | 1) {
    setDraft((old) => {
      const ids = [...old.restaurantIds];
      const target = index + direction;
      if (target < 0 || target >= ids.length) return old;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return { ...old, restaurantIds: ids };
    });
    setLineupFeedback(null);
  }

  return (
    <main className="cm-page">
      <header className="cm-hero">
        <div className="cm-wrap cm-hero-inner">
          <div>
            <p className="cm-kicker">The Food Advisor / Editorial desk</p>
            <h1>City <em>highlights.</em></h1>
            <p className="cm-intro">A small, considered selection for every city. Shape the story, choose the places, and put them in the order you would tell a friend.</p>
          </div>
          <div className="cm-hero-meta"><span>Curator workspace</span><span>01 / Collections</span></div>
        </div>
      </header>

      {!isLoaded || loading ? (
        <div className="cm-wrap cm-workspace" aria-label="Loading collections">
          <div><div className="cm-skeleton" /><div className="cm-skeleton" /><div className="cm-skeleton" /></div>
          <div><div className="cm-skeleton" /><div className="cm-skeleton" /></div>
        </div>
      ) : denied ? (
        <section className="cm-access" role="alert">
          <span className="cm-overline">Access required</span>
          <h2>This desk is for curators.</h2>
          <p>Sign in with a curator account or your administrator session to manage city highlights. Nothing here is available to public visitors.</p>
          <div className="cm-actions">
            <button type="button" className="cm-btn cm-btn-primary" onClick={() => openSignIn()} data-testid="button-curator-sign-in">Curator sign in</button>
            <Link className="cm-btn cm-btn-quiet" to="/admin/login" data-testid="link-admin-login">Administrator login</Link>
            <button type="button" className="cm-btn cm-btn-quiet" onClick={() => { setDenied(false); void loadCollections(); }} data-testid="button-retry-access">Retry access</button>
          </div>
        </section>
      ) : listError ? (
        <section className="cm-access" role="alert">
          <span className="cm-overline">Connection interrupted</span>
          <h2>We couldn’t open the desk.</h2>
          <p data-testid="status-collections-error">{listError}</p>
          <button type="button" className="cm-btn" onClick={() => void loadCollections()} data-testid="button-retry-collections"><RefreshCw size={14} /> Try again</button>
        </section>
      ) : (
        <div className="cm-wrap">
          <div className="cm-toolbar">
            <p className="cm-toolbar-note"><strong>{collections.length} {collections.length === 1 ? "collection" : "collections"}</strong> in your care · Changes are saved only when you choose to save.</p>
            <div className="cm-toolbar-actions">
              <Link to="/highlights" className="cm-btn cm-btn-quiet" data-testid="link-view-highlights">View public highlights</Link>
              <button type="button" className="cm-btn cm-btn-quiet" onClick={refreshCollections} disabled={Boolean(saving)} data-testid="button-refresh-collections"><RefreshCw size={13} /> Refresh</button>
              <button type="button" className="cm-btn cm-btn-primary" onClick={() => choose("__new__")} data-testid="button-new-collection"><Plus size={15} /> New collection</button>
            </div>
          </div>

          <div className="cm-workspace">
            <aside className="cm-sidebar" aria-label="Collections">
              <div className="cm-sidebar-head"><span className="cm-overline">Your collections</span><span className="cm-count">{String(collections.length).padStart(2, "0")}</span></div>
              {isNew && <button type="button" className="cm-collection is-active" onClick={() => choose("__new__")} data-testid="button-select-new-collection"><span className="cm-collection-city">New draft</span><span className="cm-collection-title">{draft.title || "Untitled collection"}</span><span className="cm-collection-foot">Unsaved</span></button>}
              {collections.map((item) => (
                <button type="button" key={item.id} className={`cm-collection ${selectedId === item.id ? "is-active" : ""}`} onClick={() => choose(item.id)} data-testid={`button-select-collection-${item.id}`} aria-current={selectedId === item.id ? "true" : undefined}>
                  <span className="cm-collection-city">{item.city}</span>
                  <span className="cm-collection-title" data-testid={`text-collection-title-${item.id}`}>{item.title}</span>
                  <span className="cm-collection-foot"><span>{item.restaurants.length} {item.restaurants.length === 1 ? "place" : "places"}</span><span>{Number.isNaN(new Date(item.updatedAt).getTime()) ? "" : new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></span>
                </button>
              ))}
              {!collections.length && !isNew && <p className="cm-empty-mini">No highlights yet. Start with a city you know well.</p>}
            </aside>

            {selectedId ? (
              <div className="cm-editor" key={selectedId}>
                <div className="cm-editor-head">
                  <div><span className="cm-overline">{isNew ? "New collection" : `${selected?.city ?? "Collection"} / Edit collection`}</span><h2>{isNew ? "Start a collection" : "The edit desk"}</h2></div>
                  <div className="cm-actions">
                    {isNew && <button type="button" className="cm-btn cm-btn-quiet" onClick={() => choose(collections[0]?.id ?? null)} data-testid="button-cancel-new">Cancel</button>}
                    {selected && <button type="button" className="cm-btn cm-btn-danger" onClick={() => setConfirmDelete(true)} disabled={Boolean(saving)} data-testid="button-delete-collection"><Trash2 size={13} /> Delete</button>}
                  </div>
                </div>

                {feedback && <div className={`cm-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"} data-testid="status-collection-feedback">{feedback.text}</div>}

                <form onSubmit={(event) => void saveDetails(event)}>
                  <section className="cm-section">
                    <div className="cm-section-header"><h3><span className="cm-section-index">01</span> The story</h3><span className="cm-section-note">The words diners see first.</span></div>
                    <div className="cm-fields">
                      <label className="cm-field">Collection title
                        <input required maxLength={120} value={draft.title} onChange={(event) => { setDraft((old) => ({ ...old, title: event.target.value })); setFeedback(null); }} placeholder="A late dinner in the city" data-testid="input-collection-title" />
                      </label>
                      <label className="cm-field">City
                        <select required value={draft.city} onChange={(event) => updateCity(event.target.value)} disabled={citiesLoading || Boolean(saving)} data-testid="select-collection-city">
                          <option value="">{citiesLoading ? "Loading cities…" : "Choose a city"}</option>
                          {draft.city && !cities.some((city) => city.city === draft.city) && <option value={draft.city}>{draft.city}</option>}
                          {cities.map((city) => <option value={city.city} key={city.slug}>{city.city}</option>)}
                        </select>
                      </label>
                      <label className="cm-field cm-field-wide">Description
                        <textarea required maxLength={1000} value={draft.description} onChange={(event) => { setDraft((old) => ({ ...old, description: event.target.value })); setFeedback(null); }} placeholder="What makes these tables worth seeking out?" data-testid="input-collection-description" />
                      </label>
                    </div>
                    {citiesError && <div className="cm-feedback is-error" role="alert" data-testid="status-cities-error">{citiesError} <button type="button" className="cm-btn cm-btn-quiet" onClick={() => void loadCities()} data-testid="button-retry-cities">Retry cities</button></div>}
                    {cityChanged && <p className="cm-inline-alert" role="status" data-testid="status-city-change">Changing the city clears the previous restaurant selection. Choose at least one restaurant in the new city before saving.</p>}
                    <div className="cm-savebar"><p>{isNew ? "Creating a collection saves its story and selected restaurants together." : "Save the story separately from the restaurant order."}</p><button type="submit" className="cm-btn cm-btn-primary" disabled={Boolean(saving) || (!isNew && !detailsDirty)} data-testid="button-save-collection">{saving === "details" ? "Saving…" : isNew ? "Create collection" : "Save story"}</button></div>
                  </section>
                </form>

                <section className="cm-section">
                  <div className="cm-section-header"><div><h3><span className="cm-section-index">02</span> The lineup</h3><p className="cm-help">Only published restaurants in {draft.city || "the chosen city"} can be included. The first place appears first to diners.</p></div><span className="cm-section-note">{draft.restaurantIds.length} selected</span></div>
                  <div className="cm-lineup-layout">
                    <div className="cm-lineup-box">
                      <div className="cm-box-head"><strong>Selected places</strong><span>In display order</span></div>
                      {draft.restaurantIds.length ? (
                        <ol className="cm-selected-list">
                          {draft.restaurantIds.map((id, index) => {
                            const restaurant = restaurantById.get(id);
                            return <li key={id} className="cm-selected-item" data-testid={`row-selected-restaurant-${id}`}>
                              <span className="cm-position">{String(index + 1).padStart(2, "0")}</span>
                              <span className="cm-restaurant-info"><strong>{restaurant?.name ?? "Restaurant unavailable"}</strong><small>{restaurant?.cuisine ?? restaurant?.city ?? draft.city}</small></span>
                              <span className="cm-row-actions">
                                <button type="button" className="cm-icon-btn" title="Move up" aria-label={`Move ${restaurant?.name ?? "restaurant"} up`} disabled={index === 0 || Boolean(saving)} onClick={() => moveRestaurant(index, -1)} data-testid={`button-move-up-${id}`}><ArrowUp size={14} /></button>
                                <button type="button" className="cm-icon-btn" title="Move down" aria-label={`Move ${restaurant?.name ?? "restaurant"} down`} disabled={index === draft.restaurantIds.length - 1 || Boolean(saving)} onClick={() => moveRestaurant(index, 1)} data-testid={`button-move-down-${id}`}><ArrowDown size={14} /></button>
                                <button type="button" className="cm-icon-btn" title="Remove" aria-label={`Remove ${restaurant?.name ?? "restaurant"}`} disabled={Boolean(saving)} onClick={() => { setDraft((old) => ({ ...old, restaurantIds: old.restaurantIds.filter((value) => value !== id) })); setLineupFeedback(null); }} data-testid={`button-remove-restaurant-${id}`}><X size={14} /></button>
                              </span>
                            </li>;
                          })}
                        </ol>
                      ) : <p className="cm-empty-mini">The edit starts here. Add a few places that belong in this story.</p>}
                    </div>
                    <div className="cm-lineup-box">
                      <div className="cm-box-head"><strong>Find a restaurant</strong><span>{available.length} available</span></div>
                      <div className="cm-search-wrap"><input className="cm-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by restaurant name" disabled={!draft.city} aria-label="Search restaurants" data-testid="input-search-restaurants" /></div>
                      <div className="cm-available-list">
                        {!draft.city ? <p className="cm-empty-mini">Choose a city to see its restaurants.</p>
                          : availableLoading ? <><div className="cm-skeleton" /><div className="cm-skeleton" /></>
                          : availableError ? <div className="cm-empty-mini" role="alert" data-testid="status-restaurants-error">{availableError} <button type="button" className="cm-btn cm-btn-quiet" onClick={() => setRestaurantRetry((value) => value + 1)} data-testid="button-retry-restaurants">Retry</button></div>
                          : filteredAvailable.length ? filteredAvailable.map((restaurant) => <div key={restaurant.id} className="cm-available-item" data-testid={`row-available-restaurant-${restaurant.id}`}><strong>{restaurant.name}</strong><button type="button" className="cm-add" disabled={Boolean(saving)} onClick={() => { setDraft((old) => ({ ...old, restaurantIds: [...old.restaurantIds, restaurant.id] })); setLineupFeedback(null); }} data-testid={`button-add-restaurant-${restaurant.id}`}>+ Add</button></div>)
                          : <p className="cm-empty-mini">{search ? "No restaurants match that search." : "No more published restaurants in this city to add."}</p>}
                      </div>
                    </div>
                  </div>
                  {lineupFeedback && <div className={`cm-feedback is-${lineupFeedback.kind}`} role={lineupFeedback.kind === "error" ? "alert" : "status"} data-testid="status-lineup-feedback">{lineupFeedback.text}</div>}
                  <div className="cm-savebar"><p>{isNew ? "Your lineup will be saved when you create this collection above." : cityChanged ? "Save the new city and lineup together above." : lineupDirty ? "You have unsaved changes to the restaurant selection or order." : "The saved selection and order are up to date."}</p>{!isNew && <button type="button" className="cm-btn cm-btn-primary" onClick={() => void saveLineup()} disabled={!lineupDirty || !draft.restaurantIds.length || Boolean(saving) || cityChanged} data-testid="button-save-lineup">{saving === "lineup" ? "Saving order…" : "Save selection & order"}</button>}</div>
                </section>
              </div>
            ) : (
              <div className="cm-placeholder"><span className="cm-overline">A fresh page</span><h2 className="cm-empty-title">Every good guide starts somewhere.</h2><p>Start a collection for a city you know. Choose a point of view, then add the restaurants that earn their place.</p><button type="button" className="cm-btn cm-btn-primary" onClick={() => choose("__new__")} data-testid="button-create-first-collection"><Plus size={15} /> Create a collection</button>{feedback && <div className={`cm-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"} data-testid="status-empty-feedback">{feedback.text}</div>}</div>
            )}
          </div>
        </div>
      )}

      {confirmDelete && selected && (
        <div className="cm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfirmDelete(false); }}>
          <div className="cm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cm-delete-title" aria-describedby="cm-delete-description">
            <span className="cm-overline">Permanent action</span>
            <h2 id="cm-delete-title">Remove this collection?</h2>
            <p id="cm-delete-description">“{selected.title}” and its curated lineup will disappear from city highlights. This cannot be undone.</p>
            <div className="cm-actions"><button type="button" className="cm-btn cm-btn-quiet" onClick={() => setConfirmDelete(false)} disabled={Boolean(saving)} data-testid="button-cancel-delete">Keep collection</button><button type="button" className="cm-btn cm-btn-danger" onClick={() => void deleteCollection()} disabled={Boolean(saving)} data-testid="button-confirm-delete">{saving === "delete" ? "Removing…" : "Remove collection"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}