export function Newsletter() {
  return (
    <section className="mt-12 rounded-lg border p-6 shadow-sm">
      <h2 className="font-serif text-2xl font-bold">
        Join The Food Advisor Newsletter
      </h2>
      <p className="mb-4 mt-2 text-muted-foreground">
        Weekly restaurant highlights and global food insights.
      </p>
      <a
        href="https://thefoodadvisor.substack.com"
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded bg-fa-red px-4 py-2 font-semibold text-white hover:bg-fa-red/90"
      >
        Subscribe on Substack
      </a>
    </section>
  );
}