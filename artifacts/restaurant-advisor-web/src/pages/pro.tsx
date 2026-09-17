import { BarChart3, BadgeCheck, Crown, Search, Sparkles } from 'lucide-react';
import { Link } from 'wouter';

export default function ProPage() {
  const features = [
    { label: 'Verified owner badge', icon: BadgeCheck },
    { label: 'Premium ranking priority', icon: Crown },
    { label: 'Enhanced restaurant profile tools', icon: Sparkles },
    { label: 'Owner analytics', icon: BarChart3 },
    { label: 'Featured discovery placement', icon: Search },
  ];
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">For restaurant owners</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        Food Advisor Premium
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        Claim your restaurant first, then upgrade securely from your verified
        owner portal.
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {features.map(({ label, icon: Icon }) => (
          <li key={label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-5">
            <Icon className="h-5 w-5 text-primary" />
            <span className="font-semibold">{label}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/owner/manage"
        className="mt-8 inline-block rounded bg-primary px-5 py-3 font-semibold text-primary-foreground"
      >
        Manage or upgrade your listing
      </Link>
    </main>
  );
}