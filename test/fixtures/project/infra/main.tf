resource "aws_dynamodb_table" "t" {
  name     = "t"
  hash_key = "pk"
}

resource "aws_sqs_queue" "q" {
  name = "q"
}

resource "aws_sfn_state_machine" "m" {
  name = "m"
}

data "aws_caller_identity" "me" {}

# resource "aws_kms_key" "commented_out" {}

resource "aws_cloudwatch_log_group" "lg" {
  name = "lg"
}
