export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground text-center px-4">
      <div className="space-y-4">
        <h1 className="text-8xl font-serif font-bold text-primary opacity-20">404</h1>
        <h2 className="text-2xl font-serif font-semibold">Page not found</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <a 
          href="/" 
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 mt-4"
        >
          Return Home
        </a>
      </div>
    </div>
  );
}
