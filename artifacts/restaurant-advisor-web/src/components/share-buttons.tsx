import { useMemo } from 'react';

export function ShareButtons({ slug }: { slug: string }) {
  const url = useMemo(() => {
    const path = `/restaurants/${encodeURIComponent(slug)}`;
    return typeof window === 'undefined' ? path : new URL(path, window.location.origin).href;
  }, [slug]);

  const encodedUrl = encodeURIComponent(url);
  const links = [
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${encodedUrl}` },
    {
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodedUrl}` },
  ];

  return (
    <div className="mt-6 flex flex-wrap gap-4" aria-label="Share this restaurant">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary hover:underline"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}