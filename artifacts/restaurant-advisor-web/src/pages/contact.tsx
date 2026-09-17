export default function ContactPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">Get in touch</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        Contact us
      </h1>
      <p className="mt-6 text-lg text-muted-foreground">
        Questions about a restaurant listing, an owner claim, or The Food
        Advisor?
      </p>
      <a
        href="mailto:support@thefoodadvisor.co.uk"
        className="mt-6 inline-block font-semibold text-primary hover:underline"
      >
        support@thefoodadvisor.co.uk
      </a>
    </main>
  );
}