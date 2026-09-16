import { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useClaimRestaurant } from '@workspace/api-client-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { AlertCircle, ShieldCheck, UtensilsCrossed, Check, Loader2 } from 'lucide-react';

const formSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
});

type FormValues = z.infer<typeof formSchema>;

export default function ClaimRestaurant() {
  const params = useParams<{ placeId: string }>();
  const placeId = params.placeId || '';
  const claimToken = new URLSearchParams(window.location.search).get('token') || '';
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState<'basic' | 'already_claimed' | null>(null);

  useEffect(() => {
    document.title = "Claim Your Restaurant | The Food Advisor";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'Claim your restaurant listing on The Food Advisor to update menus, photographs, reviews information, and special offers.');
    if (claimToken && placeId) {
      void fetch(
        `/api/claim/${encodeURIComponent(placeId)}?token=${encodeURIComponent(claimToken)}`,
        { cache: 'no-store' },
      );
      void fetch(`/api/restaurants/${encodeURIComponent(placeId)}/claim-click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimToken }),
      });
    }
  }, [claimToken, placeId]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  });

  const claimMutation = useClaimRestaurant();

  const isPending = claimMutation.isPending;

  const onSubmit = async (values: FormValues) => {
    setErrorMsg(null);
    try {
      const claimResult = await claimMutation.mutateAsync({
        placeId,
        data: { email: values.email, claimToken }
      });
      const portalToken = (claimResult as typeof claimResult & { portalToken?: string }).portalToken;
      if (portalToken) {
        window.location.assign(`/portal/${encodeURIComponent(portalToken)}`);
        return;
      }
      if (claimResult.status === 'basic') {
        window.location.assign(
          `/claim/${encodeURIComponent(placeId)}/success`,
        );
        return;
      }
      setClaimStatus(claimResult.status);
    } catch (err: any) {
      const msg = err?.error || err?.response?.data?.error || err?.message || "An unexpected error occurred.";
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')) {
        setErrorMsg("This claim link is invalid or has expired. Please use the link sent to your business email.");
      } else if (msg.toLowerCase().includes('already claimed')) {
        setErrorMsg("This restaurant has already been claimed.");
      } else if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('invalid')) {
        setErrorMsg("Restaurant not found. The link may be invalid.");
      } else {
        setErrorMsg(msg);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <header className="bg-background/90 backdrop-blur-md border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3 max-w-6xl mx-auto w-full">
          <div className="bg-primary text-primary-foreground p-2 rounded-lg shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">The Food Advisor</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center p-6 md:p-12 max-w-6xl mx-auto w-full gap-12 lg:gap-20">
        
        {/* Information Side */}
        <div className="flex-1 space-y-8 animate-in fade-in slide-in-from-left-8 duration-700">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-semibold shadow-sm border border-border/50">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Free basic listing claim</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold tracking-tight leading-[1.15] text-foreground">
              Take control of your establishment's presence.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
              Join the UK's most trusted restaurant network. Claim your listing to ensure diners see the most accurate and enticing version of your venue.
            </p>
          </div>

          <div className="space-y-4 pt-2">
            {[
              "Update menus, opening hours, and contact details instantly.",
              "Upload high-quality photographs of your venue and dishes.",
              "Respond to customer reviews and build your reputation.",
              "Publish special offers and seasonal promotions."
            ].map((benefit, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="mt-1 bg-primary/10 p-1.5 rounded-full text-primary shrink-0 shadow-sm">
                  <Check className="h-4 w-4" />
                </div>
                <span className="text-base text-foreground/90 font-medium leading-snug pt-0.5">{benefit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Form Side */}
        <div className="w-full max-w-md animate-in fade-in slide-in-from-right-8 duration-700 delay-150 fill-mode-both">
          <Card className="shadow-2xl border-card-border/60 bg-card/80 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary via-primary/80 to-primary/40"></div>
            <CardHeader className="pb-6 pt-8 px-8">
              <CardTitle className="text-2xl font-serif">Claim your free basic listing</CardTitle>
              <CardDescription className="text-base mt-2">
                Basic listing claims are free. Paid £99/month verification is currently unavailable.
              </CardDescription>
            </CardHeader>
            
            <CardContent className="px-8 pb-8">
              {errorMsg && (
                <div className="mb-6 bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex gap-3 items-start animate-in fade-in zoom-in-95">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{errorMsg}</p>
                </div>
              )}

              {!claimToken ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm leading-relaxed text-destructive">
                  This claim link is missing. Please use the link sent to your business email.
                </div>
              ) : claimStatus ? (
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm leading-relaxed text-foreground">
                  {claimStatus === 'basic'
                    ? 'Your free basic listing claim has been received. We will use this business email for follow-up.'
                    : 'This restaurant already has a claim on file. Its existing listing status has not been changed.'}
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground/90 font-semibold">Business Email Address</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="owner@restaurant.co.uk" 
                            type="email"
                            className="h-12 text-base bg-background/50 shadow-inner focus-visible:bg-background" 
                            disabled={isPending}
                            data-testid="input-email"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button 
                    type="submit" 
                    className="w-full h-12 text-base font-semibold shadow-md group transition-all"
                    disabled={isPending || !claimToken}
                    data-testid="button-submit-claim"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Claim free basic listing
                      </>
                    )}
                  </Button>
                  </form>
                </Form>
              )}
            </CardContent>
            <CardFooter className="bg-secondary/40 px-8 py-4 border-t border-border/50 flex justify-between items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="h-4 w-4 text-primary/70" /> No payment required
              </span>
              <span className="font-semibold text-foreground bg-background px-2.5 py-1 rounded-md shadow-sm border border-border/50">Free basic listing</span>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
