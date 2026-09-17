import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

const adminLinks = [
  {
    href: '/admin/add-restaurant',
    title: 'Add Restaurant',
    description: 'Create a new restaurant listing.',
  },
  {
    href: '/admin/restaurants',
    title: 'Manage Restaurants',
    description: 'Review existing restaurant listings.',
  },
];

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold">Admin Dashboard</h1>
      <div className="grid gap-6 md:grid-cols-2">
        {adminLinks.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-fa-red/40 hover:bg-gray-50">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold">{item.title}</h2>
                <p className="mt-2 text-muted-foreground">{item.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}