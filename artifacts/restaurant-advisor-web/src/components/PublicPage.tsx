import { type ReactNode, useEffect } from "react";

interface PublicPageProps {
  title: string;
  description: string;
  eyebrow: string;
  children: ReactNode;
}

export default function PublicPage({
  title,
  description,
  eyebrow,
  children
}: PublicPageProps) {
  useEffect(() => {
    document.title = `${title} | The Food Advisor`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = description;
    window.scrollTo(0, 0);
  }, [description, title]);

  return (
    <main className="public-page">
      <header className="public-page__hero">
        <p className="public-page__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="public-page__content">{children}</div>
    </main>
  );
}