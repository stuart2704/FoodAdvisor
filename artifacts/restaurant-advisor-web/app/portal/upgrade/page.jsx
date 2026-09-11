// Inactive draft in this Vite app; does not enable a route or paid checkout.
export default function UpgradeCenter() {
  return (
    <div>
      <h1>Upgrade to Premium</h1>
      <p>Unlock priority placement, menu integration, and your featured badge.</p>

      <a className="upgrade-button" href="/upgrade">
        Upgrade for £99/month
      </a>

      <a className="upgrade-button" href="/upgrade/preview">
        View Premium Preview
      </a>
    </div>
  );
}