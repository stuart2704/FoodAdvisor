import { useEffect, useState } from 'react';
import { RequireAdmin } from '@/components/admin/RequireAdmin';
import { AdminLayout } from '@/components/admin/AdminLayout';

type Submission = { id: string; name: string; restaurantId: string };
export default function AdminRestaurantPhotosPage() {
  const [photos, setPhotos] = useState<Submission[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/admin/restaurant-photos/pending', { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Pending photos could not be loaded.');
        return response.json() as Promise<{ photos: Submission[] }>;
      }).then(data => setPhotos(data.photos))
      .catch(failure => setError(String(failure)));
  }, []);
  async function decide(id: string, decision: 'approve' | 'reject') {
    setError('');
    try {
      const response = await fetch(`/api/admin/restaurant-photos/${id}/${decision}`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Decision could not be saved.');
      setPhotos(current => current.filter(photo => photo.id !== id));
    } catch (failure) { setError(String(failure)); }
  }
  return <RequireAdmin><AdminLayout>
    <h1>Restaurant photo review</h1>
    <p>Check that each photo actually shows the named restaurant before approving.</p>
    {error && <p role="alert">{error}</p>}
    {photos.length === 0 && <p>No pending restaurant photos.</p>}
    <div style={{ display: 'grid', gap: 20 }}>
      {photos.map(photo => <article key={photo.id}>
        <h2>{photo.name}</h2>
        <img src={`/api/admin/restaurant-photos/${photo.id}/image`} alt={`Submitted photo for ${photo.name}`} style={{ maxWidth: 320, maxHeight: 240, objectFit: 'contain' }} />
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" onClick={() => void decide(photo.id, 'approve')}>Approve</button>
          <button type="button" onClick={() => void decide(photo.id, 'reject')}>Reject</button>
        </div>
      </article>)}
    </div>
  </AdminLayout></RequireAdmin>;
}