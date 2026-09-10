import { useEffect, useState } from 'react';

export function DarkModeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('darkMode') === '1';
    } catch {
      return document.body.classList.contains('dark');
    }
  });

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    try {
      localStorage.setItem('darkMode', dark ? '1' : '0');
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }, [dark]);

  return (
    <button
      type="button"
      className="dark-toggle"
      aria-pressed={dark}
      aria-label="Dark mode"
      onClick={() => setDark((current) => !current)}
    >
      {dark ? 'Light Mode' : 'Dark Mode'}
    </button>
  );
}