import { CheckCircle2 } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ClaimSuccessPage() {
  const { id = '' } = useParams<{ id: string }>();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-xl text-center">
        <CardHeader className="items-center space-y-4">
          <span className="rounded-full bg-primary/10 p-3 text-primary">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <CardTitle className="font-serif text-3xl">
            Claim Completed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="leading-7 text-muted-foreground">
            Your restaurant has been successfully claimed. You can continue to
            your secure owner portal when a login link is provided.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href={`/restaurant/${encodeURIComponent(id)}`}>
                View restaurant
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Return home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}