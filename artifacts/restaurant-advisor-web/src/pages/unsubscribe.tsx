import { useEffect, useRef, useState } from 'react';
import { useParams } from 'wouter';
import { useUnsubscribeRestaurantOutreach } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, Loader2, UtensilsCrossed } from 'lucide-react';

export default function Unsubscribe() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const unsubscribeMutation = useUnsubscribeRestaurantOutreach();
  const hasRun = useRef(false);

  useEffect(() => {
    document.title = "Unsubscribe | The Food Advisor";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'Unsubscribe from The Food Advisor communications.');

    if (hasRun.current) return;
    if (!token) {
      setStatus('error');
      setErrorMsg("No unsubscribe token provided.");
      return;
    }
    
    hasRun.current = true;
    
    unsubscribeMutation.mutate({ token }, {
      onSuccess: () => {
        setStatus('success');
      },
      onError: (err: any) => {
        setStatus('error');
        const msg = err?.error || err?.response?.data?.error || err?.message || "An unexpected error occurred.";
        if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('token')) {
          setErrorMsg("This unsubscribe link is invalid or has expired.");
        } else {
          setErrorMsg(msg);
        }
      }
    });
  }, [token, unsubscribeMutation]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center p-6 selection:bg-primary/20 selection:text-primary">
      <div className="absolute top-6 left-6 flex items-center gap-3">
        <div className="bg-primary text-primary-foreground p-2 rounded-lg shadow-sm">
          <UtensilsCrossed className="h-5 w-5" />
        </div>
        <h1 className="font-serif text-xl font-semibold tracking-tight">The Food Advisor</h1>
      </div>

      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
        <Card className="shadow-xl border-card-border/60 bg-card/80 backdrop-blur-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-muted via-border to-muted"></div>
          <CardHeader className="text-center pb-4 pt-10 px-8">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-secondary/80 shadow-inner">
              {status === 'loading' && <Loader2 className="h-10 w-10 animate-spin text-primary" />}
              {status === 'success' && <CheckCircle2 className="h-10 w-10 text-green-600" />}
              {status === 'error' && <XCircle className="h-10 w-10 text-destructive" />}
            </div>
            <CardTitle className="font-serif text-3xl text-foreground">
              {status === 'loading' && 'Updating Preferences'}
              {status === 'success' && 'Successfully Unsubscribed'}
              {status === 'error' && 'Unsubscribe Failed'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center pb-10 px-8 pt-2">
            {status === 'loading' && (
              <p className="text-muted-foreground text-lg animate-pulse">
                Please wait while we update our communication preferences for your venue...
              </p>
            )}
            
            {status === 'success' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <p className="text-foreground/90 text-lg leading-relaxed">
                  You have been successfully removed from our automated outreach list. We will not send any further marketing communications to this venue.
                </p>
                <div className="bg-secondary/30 p-4 rounded-lg border border-border/50">
                  <p className="text-sm text-muted-foreground font-medium">
                    If this was a mistake, you can always claim your listing manually later.
                  </p>
                </div>
              </div>
            )}
            
            {status === 'error' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <p className="text-destructive font-semibold bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20 inline-block shadow-sm">
                  {errorMsg}
                </p>
                <p className="text-muted-foreground text-base">
                  If you continue to receive unwanted emails, please contact our support team directly.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
