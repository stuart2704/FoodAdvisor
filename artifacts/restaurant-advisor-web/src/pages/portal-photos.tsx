import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { portalPath, portalToken } from '@/lib/portal-access';
import { ArrowLeft, Camera, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PortalPhotosPage() {
  const token = portalToken();
  const [valid, setValid] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<{ id: string; url: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const endpoint = `/api/portal/${encodeURIComponent(token)}/photos`;

  async function refresh() {
    const response = await fetch(endpoint, { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Invalid or expired login link.');
    const data = await response.json() as { photos: { id: string; url: string; status: string }[] };
    setPhotos(data.photos);
    setValid(true);
  }

  useEffect(() => {
    setValid(null);
    void refresh().catch(() => setValid(false));
  }, [token]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setMessage('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPEG, PNG, or WebP image no larger than 5 MiB.'); return;
    }
    setBusy(true);
    try {
      const body = { contentType: file.type, sizeBytes: file.size };
      const intentResponse = await fetch(`${endpoint}/upload-intent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), referrerPolicy: 'no-referrer',
      });
      const intent = await intentResponse.json();
      if (!intentResponse.ok) throw new Error(intent.error || 'Upload could not start.');
      const uploaded = await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.uploadHeaders, body: file });
      if (!uploaded.ok) throw new Error('The file could not be uploaded.');
      const finalized = await fetch(`${endpoint}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, objectPath: intent.objectPath }), referrerPolicy: 'no-referrer',
      });
      const result = await finalized.json();
      if (!finalized.ok) throw new Error(result.error || 'The photo could not be saved.');
      await refresh();
      setMessage('Photo uploaded. It will appear publicly after admin approval.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Upload failed.');
    } finally { setBusy(false); }
  }

  async function remove(photoId: string) {
    if (!window.confirm('Remove this photo from your restaurant?')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${endpoint}/${photoId}`, { method: 'DELETE', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Photo could not be removed.');
      await refresh();
      setMessage('Photo removed.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Photo could not be removed.');
    } finally { setBusy(false); }
  }

  if (valid === null) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (!valid) {
    return <div className="flex min-h-screen items-center justify-center p-6">Invalid or expired login link.</div>;
  }
  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-3xl">
        <Link to={portalPath()} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to portal
        </Link>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Camera className="h-5 w-5 text-primary" /> Photos</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Upload up to 10 restaurant photos. JPEG, PNG or WebP, up to 5 MiB each. Photos are reviewed before diners see them.</p>
            <label className="mt-4 inline-flex cursor-pointer rounded bg-primary px-4 py-2 font-semibold text-primary-foreground">
              {busy ? 'Working…' : 'Add photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || photos.length >= 10} onChange={upload} className="sr-only" />
            </label>
            {error && <p role="alert" className="mt-3 text-red-500">{error}</p>}
            {message && <p role="status" className="mt-3">{message}</p>}
            {photos.length === 0 && <p className="mt-6 text-muted-foreground">No photos uploaded yet.</p>}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {photos.map(photo => <div key={photo.id} className="rounded border p-3">
                <img src={photo.url} alt="Your restaurant photo" className="h-48 w-full rounded object-cover" referrerPolicy="no-referrer" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="capitalize">{photo.status}</span>
                  <button type="button" disabled={busy} onClick={() => void remove(photo.id)} className="text-red-500 underline">Remove</button>
                </div>
              </div>)}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}