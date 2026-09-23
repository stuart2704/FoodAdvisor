import { useEffect, useState } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { CalendarDays, Star, Trophy } from "lucide-react";

type RewardActivity = {
  id: number;
  action: "review" | "booking";
  points: number;
  createdAt: string;
};

type RewardsPayload = {
  success: true;
  data: {
    points: number;
    activity: RewardActivity[];
  };
};

export default function RewardsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [rewards, setRewards] = useState<RewardsPayload["data"] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setRewards(null);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    fetch("/api/rewards", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as RewardsPayload | { error?: string };
        if (!response.ok || !("success" in payload) || !payload.success) {
          throw new Error("Rewards are temporarily unavailable.");
        }
        setRewards(payload.data);
        setStatus("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });

    return () => controller.abort();
  }, [isLoaded, isSignedIn]);

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.heading}>
          <span style={styles.kicker}>DINER REWARDS</span>
          <h1 style={styles.title}>Your points, clearly explained.</h1>
          <p style={styles.subtitle}>Earn 10 points for a review and 5 points when you send a booking request.</p>
        </div>

        {!isLoaded ? (
          <div style={styles.messageCard}>Loading your account…</div>
        ) : !isSignedIn ? (
          <div style={styles.messageCard}>
            <Trophy size={36} color="#d94800" aria-hidden="true" />
            <h2 style={styles.cardTitle}>Sign in to see your rewards</h2>
            <p style={styles.cardCopy}>Your balance and recent earnings are private to your account.</p>
            <button type="button" onClick={() => clerk.openSignIn()} style={styles.button}>Sign in</button>
          </div>
        ) : status === "loading" ? (
          <div style={styles.messageCard}>Loading your rewards…</div>
        ) : status === "error" ? (
          <div role="alert" style={styles.messageCard}>Rewards are temporarily unavailable. Please try again shortly.</div>
        ) : rewards ? (
          <div style={styles.grid}>
            <section style={styles.balanceCard} aria-label="Current points balance">
              <span style={styles.balanceLabel}>CURRENT BALANCE</span>
              <strong style={styles.balance}>{rewards.points}</strong>
              <span style={styles.points}>points</span>
            </section>
            <section style={styles.activityCard}>
              <h2 style={styles.cardTitle}>Recent earnings</h2>
              {rewards.activity.length === 0 ? (
                <p style={styles.empty}>Your review and booking points will appear here.</p>
              ) : (
                <ul style={styles.list}>
                  {rewards.activity.map((item) => (
                    <li key={item.id} style={styles.row}>
                      <span style={styles.icon}>
                        {item.action === "review" ? <Star size={19} aria-hidden="true" /> : <CalendarDays size={19} aria-hidden="true" />}
                      </span>
                      <span style={styles.activityCopy}>
                        <strong style={styles.action}>{item.action === "review" ? "Restaurant review" : "Booking request"}</strong>
                        <time dateTime={item.createdAt} style={styles.date}>
                          {new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        </time>
                      </span>
                      <strong style={styles.earned}>+{item.points}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "calc(100vh - 73px)", background: "#fff8ed", color: "#33221e", padding: "64px 20px" },
  shell: { width: "100%", maxWidth: 980, margin: "0 auto" },
  heading: { maxWidth: 660, marginBottom: 32 },
  kicker: { color: "#d94800", fontSize: 12, fontWeight: 800, letterSpacing: "0.14em" },
  title: { color: "#33221e", fontSize: "clamp(2.2rem, 6vw, 4.2rem)", lineHeight: 1.02, letterSpacing: "-0.045em", margin: "12px 0" },
  subtitle: { color: "#80675d", fontSize: 18, lineHeight: 1.6, margin: 0 },
  grid: { display: "grid", gridTemplateColumns: "minmax(240px, 0.7fr) minmax(0, 1.3fr)", gap: 20 },
  balanceCard: { background: "linear-gradient(145deg, #d94800, #ff6a00)", color: "#fff", borderRadius: 24, padding: 28, minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "center", boxShadow: "0 18px 44px rgba(217,72,0,.22)" },
  balanceLabel: { fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", opacity: 0.85 },
  balance: { fontSize: 80, lineHeight: 1, letterSpacing: "-0.06em", marginTop: 10 },
  points: { fontSize: 17, fontWeight: 700, opacity: 0.9 },
  activityCard: { background: "#fff", border: "1px solid #efdcca", borderRadius: 24, padding: 24, boxShadow: "0 12px 34px rgba(51,34,30,.08)" },
  messageCard: { background: "#fff", border: "1px solid #efdcca", borderRadius: 24, padding: 32, maxWidth: 560, boxShadow: "0 12px 34px rgba(51,34,30,.08)" },
  cardTitle: { color: "#33221e", fontSize: 24, margin: "8px 0 16px" },
  cardCopy: { color: "#80675d", lineHeight: 1.6, margin: "0 0 20px" },
  button: { border: 0, borderRadius: 12, background: "#d94800", color: "#fff", fontWeight: 700, padding: "12px 20px", cursor: "pointer" },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: { display: "flex", alignItems: "center", gap: 14, minHeight: 76, borderTop: "1px solid #f3e7dc" },
  icon: { width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "50%", background: "#f7e2d0", color: "#d94800", flexShrink: 0 },
  activityCopy: { display: "flex", flex: 1, flexDirection: "column", gap: 4 },
  action: { color: "#33221e", fontSize: 16 },
  date: { color: "#80675d", fontSize: 14 },
  earned: { color: "#d94800", fontSize: 20 },
  empty: { color: "#80675d", lineHeight: 1.6 },
};