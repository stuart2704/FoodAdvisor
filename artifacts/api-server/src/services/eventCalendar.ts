import type { RestaurantProfile } from "./restaurantProfileEngine";

type PublicEvent = RestaurantProfile["events"][number];

// RFC 5545 TEXT escaping; strip carriage returns before normalizing line breaks.
function escapeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let length = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (length + bytes > 75) {
      parts.push(current);
      current = " ";
      length = 1;
    }
    current += char;
    length += bytes;
  }
  parts.push(current);
  return parts.join("\r\n");
}

export function eventCalendar(
  restaurant: Pick<RestaurantProfile, "id" | "name">,
  event: PublicEvent,
  profileUrl: string,
  now = new Date(),
): string {
  // Owner events record a local wall-clock time, but no time zone or end time.
  // A floating DTSTART preserves the listed time without inventing either.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) {
    throw new Error("Event date or time is invalid.");
  }
  const start = `${event.date.replace(/-/g, "")}T${event.time.replace(":", "")}00`;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const uid = `${event.id}-${Buffer.from(restaurant.id).toString("hex")}@food-advisor`;
  const description = `${event.description}\nRestaurant: ${restaurant.name}\nPrice: ${event.price}\nProfile: ${profileUrl}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Food Advisor//Restaurant Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `SUMMARY:${escapeText(`${event.title} — ${restaurant.name}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${profileUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}