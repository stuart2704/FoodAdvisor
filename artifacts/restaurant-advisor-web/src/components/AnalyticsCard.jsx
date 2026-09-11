export default function AnalyticsCard({ title, value }) {
  return (
    <div className="analytics-card">
      <h3>{title}</h3>
      <p className="analytics-value">{value}</p>
    </div>
  );
}