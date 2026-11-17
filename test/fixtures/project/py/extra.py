"""Docstring that mentions boto3.client("sqs").send_message(QueueUrl="x") but never runs it."""
import boto3

# boto3.client("sqs").send_message(QueueUrl="x")   <- a comment, must be ignored
rds = boto3.client("rds")
s3 = boto3.client(service_name="s3")
note = 'boto3.client("sts").get_caller_identity()'
text = """
boto3.client("lambda").invoke(FunctionName="f")
"""


class Worker:
    def __init__(self):
        self.queue = boto3.Session(profile_name="dev").client("sqs")

    def send(self):
        self.queue.send_message(QueueUrl="q", MessageBody="x")


def run(name):
    rows = rds.describe_db_instances(
        DBInstanceIdentifier="db-1",
    )
    s3.write_get_object_response(RequestRoute="r", RequestToken="t")
    getattr(rds, name)()
    s3.put_objekt(Bucket="b")
    return rows
