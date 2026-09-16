import { useEffect } from 'react';
import { Clock, Mail, UtensilsCrossed } from 'lucide-react';
import { Link } from 'wouter';

export default function Support() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;

    document.title = 'Support | The Food Advisor';
    if (description) {
      description.content =
        'Get help with The Food Advisor, including subscriptions, payments, account access, and restaurant information.';
    }

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) {
        description.content = previousDescription;
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="flex items-center gap-3" aria-label="The Food Advisor home">
            <span className="rounded-lg bg-primary p-2 text-primary-foreground shadow-sm">
              <UtensilsCrossed className="h-5 w-5" />
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight md:text-2xl">
              The Food Advisor
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:px-10 md:py-20">
        <section className="mb-12">
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-primary">
            Help centre
          </p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
            The Food Advisor Support
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            If you need help with the app, your subscription, or your account, you’re in the right
            place. We’re here to make sure your experience is smooth and enjoyable.
          </p>
        </section>

        <section className="mb-12 rounded-2xl border border-card-border bg-card p-6 shadow-sm md:p-8">
          <h2 className="mb-6 text-3xl font-semibold">Contact us</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <a
              href="mailto:stuart@thefoodadvisor.co.uk"
              className="flex items-start gap-3 rounded-xl bg-muted/60 p-4 transition-colors hover:bg-muted"
            >
              <Mail className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm text-muted-foreground">Email</span>
                <span className="font-semibold">stuart@thefoodadvisor.co.uk</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  We aim to respond within 24 hours.
                </span>
              </span>
            </a>
            <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4">
              <Clock className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm text-muted-foreground">Hours</span>
                <span className="font-semibold">Monday–Friday, 9am–5pm (UK time)</span>
              </span>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-6 text-3xl font-semibold">Frequently asked questions</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card shadow-sm">
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">How do I access Premium features?</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Premium features unlock automatically once your subscription is active.
              </p>
              <p className="mt-3 leading-7 text-muted-foreground">If you don’t see them:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
                <li>Restart the app</li>
                <li>Restore purchases from the Settings menu</li>
                <li>Ensure you’re logged into the correct Apple ID</li>
              </ul>
            </article>
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">How do I restore my subscription?</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                If you reinstall the app or switch devices:
              </p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 leading-7 text-muted-foreground">
                <li>Open The Food Advisor</li>
                <li>
                  Go to <strong className="text-foreground">Settings</strong>
                </li>
                <li>
                  Tap <strong className="text-foreground">Restore Purchases</strong>
                </li>
              </ol>
            </article>
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">Payment issues</h3>
              <p className="mt-3 leading-7 text-muted-foreground">Check:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
                <li>Your Apple ID payment method</li>
                <li>Your internet connection</li>
                <li>Try again in a few minutes</li>
              </ul>
              <p className="mt-3 leading-7 text-muted-foreground">
                If issues continue, email us.
              </p>
            </article>
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">Report incorrect restaurant information</h3>
              <p className="mt-3 leading-7 text-muted-foreground">Email us with:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
                <li>Restaurant name</li>
                <li>Location</li>
                <li>What needs updating</li>
              </ul>
              <p className="mt-3 leading-7 text-muted-foreground">
                We’ll verify and update the listing.
              </p>
            </article>
          </div>
        </section>

        <section className="mb-14 rounded-2xl border border-card-border bg-card p-6 shadow-sm md:p-8">
          <h2 className="text-3xl font-semibold">App support</h2>
          <p className="mt-4 leading-7 text-muted-foreground">If you’re experiencing issues:</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
            <li>Update the app</li>
            <li>Restart your device</li>
            <li>Check your internet connection</li>
          </ul>
          <p className="mt-5 leading-7 text-muted-foreground">
            If the problem continues, email us with your device model, iOS version, a description
            of the issue, and screenshots if possible.
          </p>
        </section>

        <section id="privacy-policy" className="scroll-mt-8 border-t border-border py-12">
          <h2 className="text-3xl font-semibold">Privacy Policy</h2>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            <strong>Last updated:</strong> September 2026
          </p>
          <p className="mt-5 leading-7 text-muted-foreground">
            The Food Advisor (“we”, “us”, “our”) operates The Food Advisor mobile application and
            website. This Privacy Policy explains how we collect, use, and protect your information.
          </p>
          <div className="mt-8 space-y-8 leading-7 text-muted-foreground">
            <article>
              <h3 className="text-xl font-semibold text-foreground">1. Information We Collect</h3>
              <h4 className="mt-4 font-semibold text-foreground">Account Information</h4>
              <p>Email address, name (if provided), and basic profile details.</p>
              <h4 className="mt-4 font-semibold text-foreground">Usage Data</h4>
              <p>Screens visited, features used, search queries, and restaurant interactions.</p>
              <h4 className="mt-4 font-semibold text-foreground">Device Information</h4>
              <p>Device model, OS version, app version, and general technical data.</p>
              <h4 className="mt-4 font-semibold text-foreground">
                Subscription &amp; Transaction Data
              </h4>
              <p>
                Information about your in-app purchases and subscription status (via Apple or
                Stripe). We do not receive full payment card numbers.
              </p>
              <h4 className="mt-4 font-semibold text-foreground">Support Communications</h4>
              <p>Emails and messages you send to stuart@thefoodadvisor.co.uk.</p>
              <p className="mt-4">We do not intentionally collect sensitive personal data.</p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">
                2. How We Use Your Information
              </h3>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Operate and improve the service</li>
                <li>Verify subscription access</li>
                <li>Provide customer support</li>
                <li>Analyse performance and usage</li>
                <li>Comply with legal obligations</li>
                <li>Prevent fraud and misuse</li>
              </ul>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">3. Legal Bases (UK/EU)</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Contract – to provide the service</li>
                <li>Legitimate interests – improve and secure the app</li>
                <li>Consent – where required</li>
              </ul>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">
                4. Sharing Your Information
              </h3>
              <p className="mt-3">We may share limited data with:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Hosting providers</li>
                <li>Analytics services</li>
                <li>Payment processors (Apple, Stripe)</li>
                <li>Legal authorities when required</li>
              </ul>
              <p className="mt-3">We do not sell your personal data.</p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">5. Data Retention</h3>
              <p className="mt-3">
                We keep data as long as necessary to provide the service and meet legal
                obligations. You may request deletion.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">6. Your Rights (UK/EU)</h3>
              <p className="mt-3">You may request:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Access</li>
                <li>Correction</li>
                <li>Deletion</li>
                <li>Restriction</li>
                <li>Objection</li>
                <li>Data portability</li>
              </ul>
              <p className="mt-3">Contact: stuart@thefoodadvisor.co.uk</p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">7. Security</h3>
              <p className="mt-3">
                We use reasonable technical and organisational measures to protect your data.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">8. Children</h3>
              <p className="mt-3">
                The Food Advisor is not directed to children under 16. We do not knowingly collect
                data from children under 16.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">9. Changes</h3>
              <p className="mt-3">
                We may update this Privacy Policy. Updates will be posted here.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">10. Contact</h3>
              <p className="mt-3">Email: stuart@thefoodadvisor.co.uk</p>
              <p>Address: The Food Advisor, Cardiff, United Kingdom</p>
            </article>
          </div>
        </section>

        <section id="terms-of-service" className="scroll-mt-8 border-t border-border py-12">
          <h2 className="text-3xl font-semibold">Terms of Service</h2>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            <strong>Last updated:</strong> September 2026
          </p>
          <p className="mt-5 leading-7 text-muted-foreground">
            These Terms govern your use of The Food Advisor app and website.
          </p>
          <div className="mt-8 space-y-8 leading-7 text-muted-foreground">
            <article>
              <h3 className="text-xl font-semibold text-foreground">1. Use of the Service</h3>
              <p className="mt-3">
                You must be legally able to enter into a contract. We grant you a limited,
                non-exclusive licence for personal use.
              </p>
              <p className="mt-3">You agree not to:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Disrupt the service</li>
                <li>Scrape or copy large amounts of data</li>
                <li>Use the app unlawfully</li>
              </ul>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">
                2. Accounts &amp; Subscriptions
              </h3>
              <h4 className="mt-4 font-semibold text-foreground">Account</h4>
              <p>You are responsible for your login credentials.</p>
              <h4 className="mt-4 font-semibold text-foreground">Subscription</h4>
              <p>Premium access (£99/month) renews automatically unless cancelled.</p>
              <h4 className="mt-4 font-semibold text-foreground">Cancellation</h4>
              <p>You can cancel via:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Apple ID subscription settings</li>
                <li>Stripe/website account settings</li>
              </ul>
              <p className="mt-3">
                Premium access continues until the end of the billing period.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">3. Restaurant Listings</h3>
              <p className="mt-3">
                Restaurant information may come from third parties. We do not guarantee accuracy
                or availability.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">
                4. Intellectual Property
              </h3>
              <p className="mt-3">
                The Food Advisor name, logo, design, and content are owned by us or our licensors.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">5. Disclaimers</h3>
              <p className="mt-3">
                The service is provided “as is” without warranties. We do not guarantee
                uninterrupted availability.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">
                6. Limitation of Liability
              </h3>
              <p className="mt-3">
                We are not liable for indirect or consequential damages. Our total liability is
                limited to the amount paid in the last 12 months.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">7. Indemnity</h3>
              <p className="mt-3">
                You agree to indemnify The Food Advisor against claims arising from your use of the
                service.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">8. Changes</h3>
              <p className="mt-3">
                We may modify the service or update these Terms. Continued use means acceptance.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">9. Governing Law</h3>
              <p className="mt-3">
                These Terms are governed by the laws of England and Wales.
              </p>
            </article>
            <article>
              <h3 className="text-xl font-semibold text-foreground">10. Contact</h3>
              <p className="mt-3">Email: stuart@thefoodadvisor.co.uk</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-6 py-8 text-sm text-muted-foreground md:px-10">
          <span>© 2026 The Food Advisor</span>
          <a href="#privacy-policy" className="hover:text-primary">
            Privacy Policy
          </a>
          <a href="#terms-of-service" className="hover:text-primary">
            Terms of Service
          </a>
        </div>
      </footer>
    </div>
  );
}