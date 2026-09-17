import { Link } from 'wouter';

const links = [
  { href: '/', label: 'Home' },
  { href: '/cities', label: 'Cities' },
  { href: '/regions', label: 'Regions' },
  { href: '/countries', label: 'Countries' },
  { href: '/search', label: 'Search' },
];

export function NavBar() {
  const logoUrl = `${import.meta.env.BASE_URL}logo.png`;

  return (
    <nav className="bg-foreground text-background" aria-label="Main navigation">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4 text-base font-medium md:px-12 md:text-lg">
        <Link href="/" className="mr-1 shrink-0" aria-label="The Food Advisor home">
          <img
            src={logoUrl}
            alt="The Food Advisor"
            className="h-10 w-10 rounded-full object-cover"
          />
        </Link>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-sm underline-offset-4 transition-opacity hover:underline hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}