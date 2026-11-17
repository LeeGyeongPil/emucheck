resource "aws_sqs_queue" "orders" {
  name = "orders"
}

resource "aws_s3_bucket" "exports" {
  bucket = "orders-exports"
}

data "aws_caller_identity" "me" {}
