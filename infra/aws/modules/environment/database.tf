# Prod : RDS PostgreSQL db.t4g.micro, une zone, sauvegardes 7 jours.
# Préprod : Postgres en conteneur sur le serveur (données de démonstration).

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  count      = var.managed_database ? 1 : 0
  name       = local.prefix
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "database" {
  count       = var.managed_database ? 1 : 0
  name        = "${local.prefix}-database"
  description = "Base ${var.name} : Postgres depuis le serveur ${var.name} seulement"
  vpc_id      = var.vpc_id
  tags        = { Name = "${local.prefix}-database" }
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  count                        = var.managed_database ? 1 : 0
  security_group_id            = aws_security_group.database[0].id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.host.id
  description                  = "Postgres depuis le serveur"
}

resource "aws_db_instance" "main" {
  count = var.managed_database ? 1 : 0

  identifier     = local.prefix
  engine         = "postgres"
  engine_version = "17"
  instance_class = "db.t4g.micro"

  db_name  = "tournoi_connect"
  username = "tournoi"
  password = random_password.database.result

  allocated_storage     = 20
  max_allocated_storage = 30
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.database[0].id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  backup_window              = "01:30-02:30"
  maintenance_window         = "mon:03:00-mon:04:00"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.prefix}-final"

  performance_insights_enabled = false
  monitoring_interval          = 0

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [engine_version]
  }
}

locals {
  # RDS impose TLS ; le certificat de RDS n'est pas dans le magasin de Node,
  # d'où no-verify (trafic chiffré, interne au VPC). À durcir avec le bundle CA.
  database_url = var.managed_database ? format(
    "postgresql://tournoi:%s@%s/tournoi_connect?sslmode=no-verify",
    random_password.database.result,
    aws_db_instance.main[0].endpoint,
  ) : format("postgresql://tournoi:%s@postgres:5432/tournoi_connect", random_password.database.result)
}
