# Social automation premium lock — inactive draft

```jsx
if (!restaurant.isPremium) {
  return <PremiumLock message="Upgrade to unlock full Social Media AI automation." />;
}
```

Preserved as supplied; not connected to a live page.

## Proposed subscription entitlement rule

```javascript
if (stripeSubscriptionActive) {
  restaurant.isPremium = true;
}
```

Inactive snippet only. The flag must come from verified server-side subscription data mapped to the correct restaurant, not client input or preview state. This assignment alone does not persist an entitlement or revoke access when a subscription stops qualifying. Full lifecycle handling is required before activation.

Before activation:
- Implement and import `PremiumLock` in the intended React component.
- Derive premium access from verified server-side entitlements, never draft or preview upgrade statuses.
- Enforce authorization and entitlements on the server as well; hiding the UI does not protect automation endpoints.
- Paid verification is currently unavailable. This upgrade message must not imply that checkout or social automation is already working.
- Payment restoration alone must not enable social posting; platform authorization and explicit automation consent remain necessary.