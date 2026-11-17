import boto3
from boto3.dynamodb.conditions import Key

ddb = boto3.client("dynamodb")
logs = boto3.client(service_name="logs", region_name="us-east-1")
sfn = boto3.Session().client("stepfunctions")
table = boto3.resource("dynamodb").Table("t")
s3 = boto3.resource("s3")


def handler(event, context):
    ddb.put_item(TableName="t", Item={})
    ddb.transact_write_items(TransactItems=[])
    logs.put_log_events(logGroupName="g", logStreamName="s", logEvents=[])
    sfn.start_execution(stateMachineArn="a")
    table.query(KeyConditionExpression=Key("pk").eq("x"))
    s3.Bucket("b").upload_file("/tmp/x", "k")
    paginator = ddb.get_paginator("scan")
    for _ in paginator.paginate(TableName="t"):
        pass
    boto3.client("ses").send_email(Source="a", Destination={}, Message={})
