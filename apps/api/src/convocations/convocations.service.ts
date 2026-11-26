import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import { convocationMail } from '../mail/templates.js';
import { PUBLIC_STATUSES } from '../public/public-mapping.js';
import { DAY_FORMAT } from '../registrations/registration-state.js';
import type { ConvocationStatus } from './convocations.schemas.js';
import { buildCalendar, type CalendarEvent } from './ics.js';

const HOUR = 60 * 60_000;
/** Envoi automatique : 48 h avant le début si le tirage est fait… */
export const LEAD_DRAWN_HOURS = 48;
/** … sinon 24 h avant, avec le lieu et l'heure de début. */
export const LEAD_UNDRAWN_HOURS = 24;
/** Renvoi après un changement de calendrier : une fois les changements finis depuis 30 min. */
export const RESEND_QUIET_MINUTES = 30;

/** Avant le premier match : ni terminé, ni annulé. */
const UPCOMING = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
] as const;

const TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: 'numeric',
  minute: '2-digit',
});
/** 9 h 30, comme on l'écrit en français. */
const time = (date: Date) => TIME.format(date).replace(':', ' h ');

type Loaded = Prisma.TournamentGetPayload<{
  include: { venue: true; teams: true; matches: true };
}>;

/**
 * Convocations des équipes : un email par équipe inscrite, sans action du
 * club (48 h avant le début si le tirage est fait, sinon 24 h avant), avec
 * le programme, le lieu et l'agenda en un appui ; renvoyé seul si le
 * calendrier change ensuite. Le calendrier de l'équipe (iCalendar) se lit en
 * abonnement. Le club peut aussi envoyer les convocations tout de suite.
 */
@Injectable()
export class ConvocationsService {
  private readonly logger = new Logger('Convocations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Balayage horaire du worker : convocations arrivées à échéance, puis
   * renvoi de celles dont le calendrier a changé depuis (une fois
   * l'organisateur arrêté de modifier depuis RESEND_QUIET_MINUTES).
   */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.tournament.findMany({
      where: {
        convocationsSentAt: null,
        hiddenAt: null,
        status: { in: [...UPCOMING] },
        startsAt: {
          gt: now,
          lte: new Date(now.getTime() + LEAD_DRAWN_HOURS * HOUR),
        },
      },
      select: {
        id: true,
        startsAt: true,
        _count: { select: { matches: true } },
      },
    });
    let sent = 0;
    for (const t of due) {
      const drawn = t._count.matches > 0;
      const late =
        t.startsAt.getTime() - now.getTime() <= LEAD_UNDRAWN_HOURS * HOUR;
      if (drawn || late) {
        sent += await this.send(t.id, 'first');
      }
    }
    const quiet = new Date(now.getTime() - RESEND_QUIET_MINUTES * 60_000);
    const changed = await this.prisma.tournament.findMany({
      where: {
        convocationsSentAt: { not: null },
        scheduleChangedAt: { not: null, lte: quiet },
        hiddenAt: null,
        status: { in: [...UPCOMING] },
        startsAt: { gt: now },
      },
      select: { id: true, convocationsSentAt: true, scheduleChangedAt: true },
    });
    for (const t of changed) {
      if (t.scheduleChangedAt! > t.convocationsSentAt!) {
        sent += await this.send(t.id, 'update', t.convocationsSentAt!);
      }
    }
    return sent;
  }

  /** Où en sont les convocations d'un tournoi du club (404 hors du club). */
  async status(
    organizationSlug: string,
    slug: string,
  ): Promise<ConvocationStatus> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
      include: { _count: { select: { matches: true } } },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const recipients = await this.prisma.registration.count({
      where: {
        tournamentId: t.id,
        status: 'CONFIRMED',
        managerId: { not: null },
      },
    });
    const lead = t._count.matches > 0 ? LEAD_DRAWN_HOURS : LEAD_UNDRAWN_HOURS;
    return {
      sentAt: t.convocationsSentAt?.toISOString() ?? null,
      scheduledAt: new Date(t.startsAt.getTime() - lead * HOUR).toISOString(),
      recipients,
      // Tournoi commencé, terminé ou annulé : plus de convocation.
      sendable: this.upcoming(t),
    };
  }

  /** Envoi à la main par le club, avant l'échéance automatique. */
  async sendNow(
    organizationSlug: string,
    slug: string,
  ): Promise<ConvocationStatus> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    if (!this.upcoming(t)) {
      throw new ConflictException(
        'Ce tournoi a commencé, est terminé, annulé ou pas encore publié : pas de convocation.',
      );
    }
    await this.send(t.id, 'now');
    return this.status(organizationSlug, slug);
  }

  /**
   * Calendrier public d'une équipe (`team` : son code), ou du tournoi entier.
   * Tournoi inconnu, masqué ou équipe absente : null (404).
   */
  async calendar(slug: string, team?: string): Promise<string | null> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      include: {
        venue: true,
        teams: true,
        matches: { orderBy: { startsAt: 'asc' } },
      },
    });
    const own = team ? t?.teams.find((x) => x.code === team) : undefined;
    if (!t || (team && !own)) {
      return null;
    }
    return buildCalendar(
      own ? `${own.name} · ${t.name}` : t.name,
      this.events(t, own?.code),
      this.clock.now(),
    );
  }

  /**
   * Page « Ajouter à mon agenda » de l'app : elle choisit le bon agenda selon
   * l'appareil (abonnement webcal, Google Agenda, Outlook…). Un lien direct
   * vers le .ics n'importerait qu'une copie figée.
   */
  agendaUrl(slug: string, team: string): string {
    return this.appUrl(
      `/t/${encodeURIComponent(slug)}/agenda?team=${encodeURIComponent(team)}`,
    );
  }

  private upcoming(t: { status: string; startsAt: Date }): boolean {
    return (
      (UPCOMING as readonly string[]).includes(t.status) &&
      t.startsAt > this.clock.now()
    );
  }

  /**
   * Envoie les convocations d'un tournoi : `first` seulement si elles ne sont
   * pas déjà parties, `update` seulement si l'envoi précédent est toujours
   * `previous` (la marque est posée avant l'envoi : un second balayage
   * simultané n'envoie rien), `now` à la demande du club. Rend le nombre
   * d'emails déposés.
   */
  private async send(
    tournamentId: string,
    kind: 'first' | 'update' | 'now',
    previous?: Date,
  ): Promise<number> {
    const now = this.clock.now();
    const { count } = await this.prisma.tournament.updateMany({
      where: {
        id: tournamentId,
        ...(kind === 'first' ? { convocationsSentAt: null } : {}),
        ...(kind === 'update' ? { convocationsSentAt: previous } : {}),
      },
      data: { convocationsSentAt: now },
    });
    if (count === 0) {
      return 0;
    }
    const t = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: {
        venue: true,
        teams: true,
        matches: { orderBy: { startsAt: 'asc' } },
      },
    });
    const registrations = await this.prisma.registration.findMany({
      where: { tournamentId, status: 'CONFIRMED', teamId: { not: null } },
      include: { manager: true, team: true },
    });
    let sent = 0;
    for (const r of registrations) {
      const team = r.team;
      if (!r.manager || !team) {
        continue;
      }
      const matches = t.matches
        .filter(
          (m) => m.homeTeamCode === team.code || m.awayTeamCode === team.code,
        )
        .map((m) => {
          const home = m.homeTeamCode === team.code;
          const opponent = this.side(t, home ? 'away' : 'home', m);
          return `${time(m.startsAt)} · ${m.field} · contre ${opponent}`;
        });
      await this.mailer.send(
        convocationMail(r.manager.email, {
          team: team.name,
          tournament: t.name,
          date: DAY_FORMAT.format(t.startsAt),
          venue: `${t.venue.name}, ${t.venue.city}`,
          directionsUrl: directions(t.venue.lat, t.venue.lng),
          matches,
          start: time(t.startsAt),
          agendaUrl: this.agendaUrl(t.slug, team.code),
          pageUrl: this.appUrl(`/t/${encodeURIComponent(t.slug)}/matches`),
          update: kind === 'update',
        }),
      );
      sent += 1;
    }
    this.logger.log(
      `Convocations (${kind}) du tournoi ${t.slug} : ${sent} email(s).`,
    );
    return sent;
  }

  private events(t: Loaded, team?: string): CalendarEvent[] {
    const location = `${t.venue.name}, ${t.venue.city}`;
    const cancelled = t.status === 'CANCELLED';
    // Google et Outlook ignorent STATUS:CANCELLED d'un abonnement : le titre le dit.
    const prefix = cancelled ? 'Annulé – ' : '';
    const cancelNote =
      `${t.name} : tournoi annulé. ${t.cancellationReason ?? ''}`.trim();
    const matches = team
      ? t.matches.filter(
          (m) => m.homeTeamCode === team || m.awayTeamCode === team,
        )
      : [];
    if (matches.length === 0) {
      // Pas encore de match pour l'équipe (ou calendrier du tournoi) : le tournoi entier.
      return [
        {
          uid: `tournoi-${t.id}${team ? `-${team}` : ''}@tournoi-connect`,
          start: t.startsAt,
          end: t.endsAt,
          summary: `${prefix}${t.name}`,
          location,
          description: cancelled
            ? cancelNote
            : 'Horaires des matchs dès leur publication.',
          url: this.appUrl(`/t/${encodeURIComponent(t.slug)}`),
          cancelled,
        },
      ];
    }
    return matches.map((m) => ({
      uid: `match-${m.id}@tournoi-connect`,
      start: m.startsAt,
      end: new Date(m.startsAt.getTime() + t.matchMinutes * 60_000),
      summary: `${prefix}${this.side(t, 'home', m)} – ${this.side(t, 'away', m)}`,
      location: `${location} (${m.field})`,
      description: cancelled ? cancelNote : t.name,
      url: this.appUrl(
        `/t/${encodeURIComponent(t.slug)}/m/${encodeURIComponent(m.code)}`,
      ),
      cancelled,
    }));
  }

  /** Nom d'une équipe du match, sinon sa place à venir (« 1er poule A »). */
  private side(
    t: Loaded,
    side: 'home' | 'away',
    m: Loaded['matches'][number],
  ): string {
    const code = side === 'home' ? m.homeTeamCode : m.awayTeamCode;
    const placeholder = side === 'home' ? m.homePlaceholder : m.awayPlaceholder;
    return (
      t.teams.find((x) => x.code === code)?.name ??
      placeholder ??
      'équipe à déterminer'
    );
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}

/** Itinéraire vers le lieu, dans l'application de cartes du téléphone. */
function directions(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
