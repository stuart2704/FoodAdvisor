import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function DashboardPanel(props: {
  title: string; description: string; loading: boolean; error: string | null;
  refresh: () => void; children: ReactNode;
}) {
  return (
    <Card className="shadow-sm border-card-border" aria-label={props.title}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xl">{props.title}</CardTitle>
          <Button variant="outline" size="sm" disabled={props.loading} onClick={props.refresh}>Refresh</Button>
        </div>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {props.loading ? <p role="status" className="text-sm text-muted-foreground">Loading…</p>
          : props.error ? <p role="alert" className="text-sm text-destructive">{props.error}</p>
          : props.children}
      </CardContent>
    </Card>
  );
}