# Social automation premium lock — inactive draft

```jsx
if (!restaurant.isPremium) {
  return <PremiumLock message="Upgrade to unlock full Social Media AI automation." />;
}
```

Preserved as supplied; not connected to a live page.

Before activation:
- Implement and import `PremiumLock` in the intended React component.
- Derive premium access from verified server-side entitlements, never draft or preview upgrade statuses.
- Enforce authorization and entitlements on the server as well; hiding the UI does not protect automation endpoints.
- Paid verification is currently unavailable. This upgrade message must not imply that checkout or social automation is already working.
- Payment restoration alone must not enable social posting; platform authorization and explicit automation consent remain necessary.