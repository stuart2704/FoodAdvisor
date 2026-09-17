import { useEffect, useState } from 'react';

const languages = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
] as const;

type Language = (typeof languages)[number]['value'];

function isLanguage(value: string | null): value is Language {
  return languages.some((language) => language.value === value);
}

export function LanguageSwitcher() {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem('lang');
    if (isLanguage(stored)) setLanguage(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem('lang', language);
  }, [language]);

  return (
    <div className="flex items-center gap-2" aria-label="Language preference">
      {languages.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => setLanguage(item.value)}
          aria-pressed={language === item.value}
          className={`rounded px-2 py-1 text-xs ${
            language === item.value
              ? 'bg-background text-foreground'
              : 'text-background/75 hover:text-background'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}