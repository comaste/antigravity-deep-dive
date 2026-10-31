resource "google_artifact_registry_repository" "app_repo" {
  project       = var.project_id
  location      = var.region
  repository_id = var.service_name
  description   = "Docker repository for ${var.service_name}"
  format        = "DOCKER"

  depends_on = [
    google_project_service.enabled_apis["artifactregistry.googleapis.com"]
  ]
}

resource "google_service_account" "cloud_run_sa" {
  project      = var.project_id
  account_id   = "${var.service_name}-sa"
  display_name = "Cloud Run Service Account for ${var.service_name}"
}

locals {
  cloud_run_roles = toset([
    "roles/datastore.user",
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.user",
  ])
}

resource "google_project_iam_member" "cloud_run_sa_roles" {
  for_each = local.cloud_run_roles
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_cloud_run_v2_service" "app" {
  project  = var.project_id
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run_sa.email

    containers {
      image = var.container_image

      ports {
        container_port = 3001
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "GCP_REGION"
        value = var.region
      }

      env {
        name  = "ALLOWED_GOOGLE_DOMAIN"
        value = var.allowed_google_domain
      }

      env {
        name = "NOTION_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_secrets["notion-oauth-client-secret"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "BOX_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_secrets["box-oauth-client-secret"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_secrets["gemini-api-key"].secret_id
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.enabled_apis["run.googleapis.com"],
    google_project_iam_member.cloud_run_sa_roles,
    google_secret_manager_secret_version.app_secret_initial_versions,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count    = var.enable_public_access ? 1 : 0
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
