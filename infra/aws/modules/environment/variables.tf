variable "name" {
  description = "Nom de l'environnement : preprod ou prod."
  type        = string
  validation {
    condition     = contains(["preprod", "prod"], var.name)
    error_message = "Environnements connus : preprod, prod."
  }
}

variable "app_host" {
  description = "Nom d'hôte de la PWA (SSR)."
  type        = string
}

variable "api_host" {
  description = "Nom d'hôte de l'API."
  type        = string
}

variable "zone_id" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "instance_type" {
  type = string
}

variable "artifacts_bucket" {
  type = object({ id = string, arn = string })
}

variable "managed_database" {
  description = "true : base RDS (prod) ; false : Postgres en conteneur sur le serveur (préprod)."
  type        = bool
}

variable "seed_demo" {
  description = "Recharge les données de démonstration à chaque déploiement de l'API (jamais en prod)."
  type        = bool
  default     = false
}

variable "indexable" {
  description = "false : en-tête X-Robots-Tag noindex sur tous les sites de l'environnement."
  type        = bool
}

variable "host_files" {
  description = "Fichiers communs déposés sur le serveur (compose.yml, deploy.sh)."
  type        = map(string)
}

variable "ses_identity_arn" {
  description = "Identité SES du domaine : le serveur peut envoyer en son nom."
  type        = string
}

variable "mail_from" {
  description = "Expéditeur des emails (codes de connexion, invitations)."
  type        = string
}
