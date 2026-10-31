output "cloud_run_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.app.uri
}

output "firestore_database_name" {
  description = "Name of the Firestore database"
  value       = google_firestore_database.default.name
}

output "artifact_registry_repository" {
  description = "Docker repository URI in Artifact Registry"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}"
}
