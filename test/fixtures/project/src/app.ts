import { DynamoDBClient, PutItemCommand, QueryCommand as Q } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import * as sqs from "@aws-sdk/client-sqs";
import { S3 } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { CloudWatchLogsClient, PutLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { Upload } from "@aws-sdk/lib-storage";
import { paginateListObjectsV2, S3Client } from "@aws-sdk/client-s3";

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

export async function run() {
  await ddb.send(new PutItemCommand({ TableName: "t", Item: {} }));
  await ddb.send(new Q({ TableName: "t" }));
  await doc.send(new GetCommand({ TableName: "t", Key: {} }));
  await new sqs.SQSClient({}).send(new sqs.SendMessageCommand({ QueueUrl: "q", MessageBody: "x" }));
  const s3 = new S3({});
  await s3.putObject({ Bucket: "b", Key: "k", Body: "x" });
  await s3.selectObjectContent({ Bucket: "b", Key: "k" } as any);
  await new SFNClient({}).send(new StartExecutionCommand({ stateMachineArn: "a" }));
  await new CloudWatchLogsClient({}).send(new PutLogEventsCommand({ logGroupName: "g", logStreamName: "s", logEvents: [] }));
  await new Upload({ client: new S3Client({}), params: { Bucket: "b", Key: "k", Body: "x" } }).done();
  for await (const _ of paginateListObjectsV2({ client: new S3Client({}) }, { Bucket: "b" })) { /* */ }
}
