#!/bin/bash
# Déploiement sur le serveur, lancé par SSM depuis la CI ou au premier démarrage.
#   deploy.sh front      charge la dernière image de la PWA puis relance
#   deploy.sh api        charge la dernière image de l'API, migre, relance API et worker
#   deploy.sh all        les deux (premier démarrage, serveur remplacé)
#   deploy.sh config     relit seulement la configuration (SSM, compose, Caddyfile)
# Les images viennent de s3://<bucket>/images/<service>/<env>.tar.gz.
set -euo pipefail

DIR=/opt/tournoi-connect
cd "$DIR"
# shellcheck source=/dev/null
source "$DIR/host.env"
export AWS_DEFAULT_REGION
umask 077

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

sync_host_files() {
  local next="$DIR/.next"
  rm -rf "$next" && mkdir -p "$next"
  aws s3 cp "s3://$TC_BUCKET/host/$TC_ENV/" "$next/" --recursive --only-show-errors
  # Remplacement par renommage : un deploy.sh en cours garde son ancienne copie.
  for f in "$next"/*; do mv -f "$f" "$DIR/"; done
  chmod 750 "$DIR/deploy.sh"
  rm -rf "$next"
}

render_env() {
  aws ssm get-parameters-by-path --path "/tournoi-connect/$TC_ENV/" --recursive \
    --with-decryption --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      printf "%s='%s'\n" "${name##*/}" "$value"
    done > "$DIR/.env.next"
  mv -f "$DIR/.env.next" "$DIR/.env"
  touch "$DIR/versions.env"
}

set_version() {
  local key=$1 value=$2
  grep -v "^$key=" "$DIR/versions.env" > "$DIR/versions.env.next" || true
  echo "$key=$value" >> "$DIR/versions.env.next"
  mv -f "$DIR/versions.env.next" "$DIR/versions.env"
}

# Charge l'archive courante d'un service ; renvoie 1 si elle n'existe pas encore.
load_image() {
  local service=$1 key="images/$1/$TC_ENV.tar.gz" loaded tag
  if ! aws s3api head-object --bucket "$TC_BUCKET" --key "$key" > /dev/null 2>&1; then
    log "pas encore d'image pour $service"
    return 1
  fi
  loaded=$(aws s3 cp "s3://$TC_BUCKET/$key" - --only-show-errors | gunzip | docker load)
  tag=$(echo "$loaded" | sed -n "s/^Loaded image: tournoi-connect-$service://p" | tail -1)
  [ -n "$tag" ] || { log "archive $key sans image tournoi-connect-$service"; exit 1; }
  log "$service : version $tag"
  set_version "$(echo "$service" | tr '[:lower:]' '[:upper:]')_TAG" "$tag"
}

compose() {
  docker compose --env-file "$DIR/.env" --env-file "$DIR/versions.env" "$@"
}

has_version() { grep -q "^$1=" "$DIR/versions.env"; }

wait_healthy() {
  local service=$1
  for _ in $(seq 1 40); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q "$service")" 2>/dev/null || echo absent)
    [ "$status" = healthy ] && { log "$service en bonne santé"; return 0; }
    sleep 3
  done
  log "$service n'est pas en bonne santé"
  compose logs --tail 80 "$service"
  return 1
}

target=${1:-config}
sync_host_files
render_env

case "$target" in
  front) load_image front ;;
  api) load_image api ;;
  all) load_image front || true; load_image api || true ;;
  config) ;;
  *) echo "usage : deploy.sh front|api|all|config" >&2; exit 2 ;;
esac

services=(caddy redis)
grep -q "^COMPOSE_PROFILES='local-db'" "$DIR/.env" && services+=(postgres)
compose up -d --remove-orphans "${services[@]}"

if has_version API_TAG; then
  if [ "$target" = api ] || [ "$target" = all ]; then
    log "migrations"
    compose run --rm migrate
    if grep -q "^SEED_DEMO='true'" "$DIR/.env"; then
      log "données de démonstration"
      compose run --rm seed
    fi
  fi
  compose up -d api worker
  wait_healthy api
fi

if has_version FRONT_TAG; then
  compose up -d front
  wait_healthy front
fi

# Caddy relit son Caddyfile s'il a changé.
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile > /dev/null 2>&1 || true
docker image prune -af --filter "until=168h" > /dev/null
log "terminé ($target)"
