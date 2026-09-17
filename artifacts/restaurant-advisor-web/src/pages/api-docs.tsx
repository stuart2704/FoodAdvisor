interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  description: string;
  access: 'Public' | 'Signed in' | 'Owner token';
}

const endpoints: Endpoint[] = [
  { method: 'GET', path: '/api/cities', description: 'List cities and restaurant counts.', access: 'Public' },
  { method: 'GET', path: '/api/regions', description: 'List restaurant regions.', access: 'Public' },
  { method: 'GET', path: '/api/countries', description: 'List available countries.', access: 'Public' },
  { method: 'GET', path: '/api/restaurants/:slug', description: 'Get a public restaurant profile.', access: 'Public' },
  { method: 'POST', path: '/api/bookings', description: 'Submit a booking request. Signed-in users earn five points.', access: 'Public' },
  { method: 'POST', path: '/api/reviews', description: 'Submit a restaurant review and earn ten points.', access: 'Signed in' },
  { method: 'GET', path: '/api/rank', description: 'Get the top 50 restaurants using the canonical ranking policy.', access: 'Public' },
  { method: 'GET', path: '/api/trends', description: 'Get trending cuisines and cities.', access: 'Public' },
  { method: 'GET', path: '/api/heatmap', description: 'Get bounded cuisine-location data for mapped restaurants.', access: 'Public' },
  { method: 'POST', path: '/api/chatbot', description: 'Find restaurants by cuisine or city.', access: 'Public' },
  { method: 'GET', path: '/api/qrcode/:id', description: 'Generate a shareable restaurant QR code.', access: 'Public' },
  { method: 'GET', path: '/api/rewards', description: 'Get the current diner’s reward balance and activity.', access: 'Signed in' },
  { method: 'POST', path: '/api/menu-ocr', description: 'Extract text from a JPEG, PNG, or WebP menu image.', access: 'Owner token' },
  { method: 'GET', path: '/api/portal/:token/forecast', description: 'Get an illustrative owner engagement projection. This is not a revenue forecast.', access: 'Owner token' },
];

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">Developer reference</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        Food Advisor API
      </h1>
      <p className="mt-5 max-w-3xl text-muted-foreground">
        All browser clients should use relative API paths. Successful newer
        endpoints generally return <code>{'{ success: true, data }'}</code>;
        validation and service errors return an appropriate HTTP status with an
        error message.
      </p>
      <div className="mt-10 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-4">Method</th>
              <th className="p-4">Endpoint</th>
              <th className="p-4">Access</th>
              <th className="p-4">Description</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((endpoint) => (
              <tr key={`${endpoint.method}:${endpoint.path}`} className="border-t border-border">
                <td className="p-4 font-mono font-semibold">{endpoint.method}</td>
                <td className="whitespace-nowrap p-4 font-mono">{endpoint.path}</td>
                <td className="whitespace-nowrap p-4">{endpoint.access}</td>
                <td className="min-w-72 p-4 text-muted-foreground">{endpoint.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="font-serif text-2xl font-semibold">Owner authentication</h2>
        <p className="mt-3 text-muted-foreground">
          Menu OCR requires the portal token in the <code>X-Portal-Token</code>
          request header. Owner URLs containing a token must not be shared,
          logged, or used as public API examples.
        </p>
      </section>
    </main>
  );
}