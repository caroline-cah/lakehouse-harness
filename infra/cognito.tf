# Inbound auth for the gateway: machine-to-machine OAuth (client_credentials) from a Cognito user pool.
resource "aws_cognito_user_pool" "gw" {
  name = "${local.name}-gateway"
}

resource "aws_cognito_user_pool_domain" "gw" {
  domain       = "${local.name}-${local.account_id}"
  user_pool_id = aws_cognito_user_pool.gw.id
}

resource "aws_cognito_resource_server" "gw" {
  identifier   = "lakehouse-gateway"
  name         = "lakehouse-gateway"
  user_pool_id = aws_cognito_user_pool.gw.id
  scope {
    scope_name        = "invoke"
    scope_description = "Call lakehouse tools through the gateway"
  }
}

resource "aws_cognito_user_pool_client" "agent" {
  name                                 = "${local.name}-agent"
  user_pool_id                         = aws_cognito_user_pool.gw.id
  generate_secret                      = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = aws_cognito_resource_server.gw.scope_identifiers
  supported_identity_providers         = ["COGNITO"]
  access_token_validity                = 60
  token_validity_units {
    access_token = "minutes"
  }
}

# The secret is read at runtime by the agent; it never appears in Terraform outputs.
resource "aws_ssm_parameter" "gateway_client_secret" {
  name  = "/${local.name}/gateway/client-secret"
  type  = "SecureString"
  value = aws_cognito_user_pool_client.agent.client_secret
}

locals {
  cognito_discovery_url = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.gw.id}/.well-known/openid-configuration"
  cognito_token_url     = "https://${aws_cognito_user_pool_domain.gw.domain}.auth.${local.region}.amazoncognito.com/oauth2/token"
}

output "cognito_token_url" {
  value = local.cognito_token_url
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.agent.id
}

output "cognito_secret_param" {
  value = aws_ssm_parameter.gateway_client_secret.name
}
