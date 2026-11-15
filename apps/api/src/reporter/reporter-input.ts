/** Au plus une notification de but toutes les 20 secondes par match. */
export const GOAL_PUSH_INTERVAL_MS = 20_000;

/**
 * Notifie-t-on le dernier but ? `goals` : instants de tous les buts du match
 * dans l'ordre d'enregistrement (annulés compris : leur notification est
 * partie), le dernier étant la saisie en cours. Un but part si le dernier but
 * notifié date d'au moins 20 secondes ; ceux d'entre-temps restent au fil sans
 * notification, et le score de la notification suivante (ou de la fin du
 * match) les inclut. Le calcul ne dépend que du fil : il donne le même
 * résultat sur chaque instance de l'API.
 */
export function goalNotified(goals: readonly Date[]): boolean {
  let lastNotified: number | null = null;
  let notified = false;
  for (const at of goals) {
    const time = at.getTime();
    notified =
      lastNotified === null || time - lastNotified >= GOAL_PUSH_INTERVAL_MS;
    if (notified) {
      lastNotified = time;
    }
  }
  return notified;
}

/**
 * Texte libre du rapporteur (buteur, passeur, légende) tel qu'affiché au fil
 * et dans les notifications : caractères de contrôle et de mise en forme
 * invisibles (inversion bidi, espaces de largeur nulle) retirés, espaces
 * regroupés. Vide après nettoyage : rien.
 */
export function cleanText(value: string | undefined): string | undefined {
  const cleaned = value
    ?.normalize('NFC')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned : undefined;
}
