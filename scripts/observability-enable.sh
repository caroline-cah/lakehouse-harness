#!/usr/bin/env bash
# One-time account setup so AgentCore Runtime spans land in CloudWatch (Transaction Search).
set -euo pipefail
REGION=${AWS_REGION:-eu-central-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws logs put-resource-policy --region "$REGION" --policy-name TransactionSearchXRayAccess --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"TransactionSearchXRayAccess\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"xray.amazonaws.com\"},\"Action\":\"logs:PutLogEvents\",\"Resource\":[\"arn:aws:logs:$REGION:$ACCOUNT:log-group:aws/spans:*\",\"arn:aws:logs:$REGION:$ACCOUNT:log-group:/aws/application-signals/data:*\"],\"Condition\":{\"ArnLike\":{\"aws:SourceArn\":\"arn:aws:xray:$REGION:$ACCOUNT:*\"},\"StringEquals\":{\"aws:SourceAccount\":\"$ACCOUNT\"}}}]}" >/dev/null
aws xray update-trace-segment-destination --region "$REGION" --destination CloudWatchLogs >/dev/null
aws xray update-indexing-rule --region "$REGION" --name Default --rule '{"Probabilistic":{"DesiredSamplingPercentage":100}}' >/dev/null
aws xray get-trace-segment-destination --region "$REGION"
