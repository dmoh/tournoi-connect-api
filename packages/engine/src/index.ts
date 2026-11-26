export { advanceBracket, type Assignment, type MatchState } from './advance.js';
export {
  drawTournament,
  MAX_BRACKET,
  sourceLabel,
  type Draw,
  type DrawInput,
  type FormatKind,
  type Phase,
  type PlannedMatch,
  type Source,
} from './bracket.js';
export { generateRoundRobin, type Pairing } from './round-robin.js';
export {
  rulesFor,
  SPORT_RULES,
  TIEBREAKERS,
  validateRules,
  type LosingBonus,
  type PointsRule,
  type RankingRules,
  type Sport,
  type Tiebreaker,
} from './rules.js';
export {
  scheduleMatches,
  type ScheduledMatch,
  type ScheduleInput,
} from './schedule.js';
export {
  computeStandings,
  computeSwissStandings,
  FOOTBALL_POINTS,
  type GroupResult,
  type GroupStanding,
  type StandingRow,
  type StandingTeam,
  type SwissStandingRow,
} from './standings.js';
export {
  pairSwissRound,
  swissRoundCount,
  type SwissInput,
  type SwissRound,
} from './swiss.js';
export {
  podium,
  topScorers,
  type Goal,
  type Podium,
  type PodiumInput,
  type PodiumMatch,
  type Scorer,
} from './podium.js';
