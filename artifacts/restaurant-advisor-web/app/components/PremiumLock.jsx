export default function PremiumLock({ message }) {
  return (
    <div className="premium-lock">
      <h3>Premium Feature</h3>
      <p>{message}</p>
      <a className="upgrade-button" href="/portal/upgrade">
        Upgrade for £99/month
      </a>
    </div>
  );
}