import { useEffect, useState } from 'react';

type Currency = 'GBP' | 'USD' | 'EUR';

const SYMBOLS: Record<Currency, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
};

export function CurrencySwitcher() {
  const [currency, setCurrency] = useState<Currency>('GBP');

  useEffect(() => {
    const saved = window.localStorage.getItem('foodAdvisorCurrency');
    if (saved === 'GBP' || saved === 'USD' || saved === 'EUR') {
      setCurrency(saved);
    }
  }, []);

  return (
    <select
      aria-label="Display currency"
      className="rounded border border-background/40 bg-transparent p-2 text-sm"
      value={currency}
      onChange={(event) => {
        const next = event.target.value as Currency;
        setCurrency(next);
        window.localStorage.setItem('foodAdvisorCurrency', next);
        window.dispatchEvent(
          new CustomEvent('food-advisor-currency-change', { detail: next }),
        );
      }}
    >
      {(Object.keys(SYMBOLS) as Currency[]).map((code) => (
        <option key={code} value={code} className="text-foreground">
          {code} ({SYMBOLS[code]})
        </option>
      ))}
    </select>
  );
}