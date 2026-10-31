variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region (Tokyo region by default)"
  type        = string
  default     = "asia-northeast1"
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "notion-box-search"
}

variable "allowed_google_domain" {
  description = "Allowed Google Workspace domain for IAP / authentication"
  type        = string
  default     = "cureapp.jp"
}

variable "container_image" {
  description = "Container image URI for Cloud Run service"
  type        = string
}
