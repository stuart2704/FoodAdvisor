import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetCheckoutCompletion, getGetCheckoutCompletionQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, ShieldCheck, UtensilsCrossed, ArrowRight, XCircle } from 'lucide-react';

export default function ClaimSuccess() {
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    document.title = "Verification Status | The Food Advisor";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'Check the status of your restaurant ownership verification.');
  }, []);

  const { data, isLoading, isError, error } = useGetCheckoutCompletion(sessionId || '', {
    query: {
      enabled: !!sessionId,
      refetchInterval: (queryOrData: any) => {
        // Handle both TanStack Query v4 (data) and v5 (query) signatures
        const d = queryOrData?.state?.data || (queryOrData?.claimStatus ? queryOrData : null);
        if (d) {
          const isPending = d.paymentStatus === 'processing' || 
                            d.claimStatus === 'processing' || 
                            d.claimStatus === 'checkout_created' || 
                            d.claimStatus === 'pending_checkout';
          return isPending ? 2000 : false;
        }
        return false;
      },
      queryKey: getGetCheckoutCompletionQueryKey(sessionId || '')
    }
  });

  const renderContent = () => {
    if (!sessionId) {
      return (
        <StatusCard 
          icon={<AlertCircle className="h-10 w-10 text-destructive" />}
          title="Invalid Request"
          description="We couldn't find a payment session to verify."
          content="If you just completed a payment, please check your email for a confirmation link, or contact our support team."
          actionText="Return Home"
          actionHref="/"
          actionTestId="button-return-home-invalid"
        />
      );
    }

    if (isLoading) {
      return (
        <StatusCard 
          icon={<Loader2 className="h-10 w-10 text-primary animate-spin" />}
          title="Confirming Payment"
          description="Please wait while we verify your transaction securely."
          content="This usually takes just a few seconds. Do not close this page."
          hideAction
        />
      );
    }

    if (isError) {
      const msg = (error as any)?.error || "We encountered an issue checking your payment status. Please try refreshing the page in a few moments, or contact support if the issue persists.";
      return (
        <StatusCard 
          icon={<AlertCircle className="h-10 w-10 text-destructive" />}
          title="Verification Error"
          description="There was a problem verifying your session."
          content={msg}
          actionText="Return Home"
          actionHref="/"
          actionTestId="button-return-home-error"
        />
      );
    }

    if (!data) return null;

    const { paymentStatus, claimStatus, name } = data;
    const isProcessing = paymentStatus === 'processing' || claimStatus === 'processing' || claimStatus === 'checkout_created';
    const restaurantName = name || 'your restaurant';

    if (isProcessing) {
      return (
        <StatusCard 
          icon={<Loader2 className="h-10 w-10 text-primary animate-spin" />}
          title="Processing Verification"
          description="Your payment has been received and is being processed."
          content="We are setting up your verified profile. This page will update automatically when complete."
          hideAction
        />
      );
    }

    if (paymentStatus === 'unpaid' || claimStatus === 'pending_checkout') {
      return (
        <StatusCard 
          icon={<XCircle className="h-10 w-10 text-destructive" />}
          title="Payment Incomplete"
          description="Your checkout session was not completed."
          content="Your account has not been charged. You can try claiming your restaurant again whenever you're ready."
          actionText="Return Home"
          actionHref="/"
          actionTestId="button-return-home-unpaid"
        />
      );
    }

    if (claimStatus === 'past_due' || claimStatus === 'revoked') {
      return (
        <StatusCard 
          icon={<AlertCircle className="h-10 w-10 text-destructive" />}
          title="Subscription Issue"
          description="There is an issue with your subscription."
          content={`Your access for ${restaurantName} is currently ${claimStatus === 'past_due' ? 'past due' : 'revoked'}. Please check your billing details.`}
          actionText="Return Home"
          actionHref="/"
          actionTestId="button-return-home-issue"
        />
      );
    }

    if (claimStatus === 'active' && (paymentStatus === 'paid' || paymentStatus === 'no_payment_required')) {
      return (
        <StatusCard 
          icon={<ShieldCheck className="h-10 w-10 text-primary" />}
          title="Verification Complete"
          description="Thank you for your payment."
          content={`Your claim for ${restaurantName} is now active. You have full access to your verified owner profile and management tools.`}
          actionText="Go to Dashboard"
          actionHref="/"
          actionTestId="button-dashboard-active"
          success
        />
      );
    }

    // Fallback for unknown states
    return (
      <StatusCard 
        icon={<AlertCircle className="h-10 w-10 text-muted-foreground" />}
        title="Payment Under Review"
        description="Your payment status is currently under review."
        content="Please check your email for a receipt or contact our support team if you need immediate assistance."
        actionText="Return Home"
        actionHref="/"
        actionTestId="button-return-home-unknown"
      />
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col selection:bg-primary/20 selection:text-primary">
      <header className="bg-background/90 backdrop-blur-md border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3 max-w-6xl mx-auto w-full">
          <div className="bg-primary text-primary-foreground p-2 rounded-lg shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">The Food Advisor</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 w-full">
        <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-700">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

function StatusCard({ 
  icon, 
  title, 
  description, 
  content, 
  actionText, 
  actionHref, 
  actionTestId,
  hideAction = false,
  success = false
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  content: string;
  actionText?: string;
  actionHref?: string;
  actionTestId?: string;
  hideAction?: boolean;
  success?: boolean;
}) {
  const [, setLocation] = useLocation();
  
  return (
    <Card className={`shadow-2xl border-card-border/60 bg-card/80 backdrop-blur-xl relative overflow-hidden ${success ? 'border-primary/30' : ''}`}>
      {success && <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary via-primary/80 to-primary/40"></div>}
      <CardHeader className="pb-4 pt-10 px-8 flex flex-col items-center text-center space-y-4">
        <div className={`p-4 rounded-full ${success ? 'bg-primary/10' : 'bg-muted'} shadow-sm`}>
          {icon}
        </div>
        <div className="space-y-2">
          <CardTitle className="text-3xl font-serif">{title}</CardTitle>
          <CardDescription className="text-base font-medium text-foreground/80">{description}</CardDescription>
        </div>
      </CardHeader>
      
      <CardContent className="px-8 pb-8 text-center text-muted-foreground leading-relaxed">
        <p>{content}</p>
      </CardContent>
      
      {!hideAction && actionText && actionHref && (
        <CardFooter className="bg-secondary/40 px-8 py-6 border-t border-border/50 flex justify-center">
          <Button 
            className="w-full h-12 text-base font-semibold shadow-md group transition-all"
            onClick={() => setLocation(actionHref)}
            data-testid={actionTestId}
          >
            {actionText}
            <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
