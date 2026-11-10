variable "account_id" {
  description = "Compte AWS autorisé : Terraform refuse de s'exécuter ailleurs."
  type        = string
  default     = "677142166254"
}

variable "region" {
  type    = string
  default = "eu-west-3"
}

variable "domain" {
  description = "Domaine du projet, zone Route 53 créée à l'achat du domaine."
  type        = string
  default     = "tournoi-connect.com"
}

variable "github_repositories" {
  description = "Dépôts autorisés à déployer par OIDC (aucune clé longue durée)."
  type        = list(string)
  default     = ["dmoh/tournoi-connect-front", "dmoh/tournoi-connect-api"]
}

variable "instance_type" {
  description = "Type des serveurs : petits types seulement (budget, garde-fous IAM)."
  type        = string
  default     = "t3a.small"
}
