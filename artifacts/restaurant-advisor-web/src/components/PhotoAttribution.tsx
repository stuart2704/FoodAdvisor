export type PhotoCredit = { displayName: string; uri: string | null };
export type PlacePhoto = { url: string; attribution: PhotoCredit[] };

export default function PhotoAttribution({ attribution }: { attribution: PhotoCredit[] }) {
  if (!attribution.length) return null;
  return (
    <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
      Photo: {attribution.map((author, i) => (
        <span key={`${author.displayName}-${i}`}>
          {i > 0 && ", "}
          {author.uri ? (
            <a href={author.uri} target="_blank" rel="noopener noreferrer">{author.displayName}</a>
          ) : author.displayName}
        </span>
      ))}
    </div>
  );
}