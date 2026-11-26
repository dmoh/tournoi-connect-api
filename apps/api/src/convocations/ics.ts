/**
 * Calendrier iCalendar (RFC 5545) d'une équipe : un événement par match, ou
 * le tournoi entier tant qu'aucun match n'est programmé. Servi en
 * abonnement (webcal) : l'agenda suit les changements d'horaire sans
 * nouvelle action de la personne.
 */
export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  url: string;
  /** Événement annulé (tournoi annulé) : l'agenda le barre ou le retire. */
  cancelled?: boolean;
}

/** 2026-12-05T08:30:00.000Z → 20261205T083000Z */
export function icsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Texte d'une propriété : antislash, virgule, point-virgule et sauts de ligne échappés. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Lignes de 75 octets au plus, suites précédées d'une espace (RFC 5545 § 3.1). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Première ligne : 75 octets ; suivantes : 74 (l'espace de tête compte).
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildCalendar(
  name: string,
  events: readonly CalendarEvent[],
  now: Date,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tournoi Connect//Convocations//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    // Rafraîchi toutes les heures par les agendas qui le lisent.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(event.start)}`,
      `DTEND:${icsDate(event.end)}`,
      `SUMMARY:${icsText(event.summary)}`,
      `LOCATION:${icsText(event.location)}`,
      `DESCRIPTION:${icsText(event.description)}`,
      `URL:${event.url}`,
      `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
