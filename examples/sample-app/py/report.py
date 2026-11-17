"""Nightly report job for the sample project (boto3)."""
import boto3

athena = boto3.client("athena")
logs = boto3.client(service_name="logs")
table = boto3.resource("dynamodb").Table("orders")


def run(day):
    # boto3.client("ses").send_email(...) in a comment is ignored
    named = athena.list_named_queries(WorkGroup="primary")
    athena.start_query_execution(QueryString="select 1", WorkGroup="primary")
    logs.put_log_events(logGroupName="g", logStreamName=day, logEvents=[])
    table.query(KeyConditionExpression="c = :c")
    return named
