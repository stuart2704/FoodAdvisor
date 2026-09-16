import { Link, useParams } from 'wouter';
import { ArrowLeft, UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PortalMenuPage() {
  const { token = '' } = useParams<{ token: string }>();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-3xl">
        <Link href={`/portal/${token}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to portal
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5 text-primary" /> Menu
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Menu management is not enabled yet. No menu data has been imported or changed.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}