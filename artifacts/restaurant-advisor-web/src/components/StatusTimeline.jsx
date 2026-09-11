export default function StatusTimeline({ timeline }) {
  return (
    <div className="timeline">
      <h2>Status Timeline</h2>
      <ul>
        {timeline.map((item, i) => (
          <li key={i}>
            <strong>{item.status}</strong> — {item.date}
          </li>
        ))}
      </ul>
    </div>
  );
}