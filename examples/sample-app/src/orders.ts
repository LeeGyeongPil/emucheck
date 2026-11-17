// Sample project for `npm start`: a small order service written against AWS SDK for JavaScript v3.
import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { S3 } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { APIGateway } from "@aws-sdk/client-api-gateway";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const ddb = new DynamoDBClient({});
const s3 = new S3({});
const gateway = new APIGateway({});

export async function placeOrder(id: string) {
  await ddb.send(new PutItemCommand({ TableName: "orders", Item: { id: { S: id } } }));
  await new SQSClient({}).send(new SendMessageCommand({ QueueUrl: "q", MessageBody: id }));
  await new SFNClient({}).send(new StartExecutionCommand({ stateMachineArn: "arn", input: id }));
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: "notify" }));
}

export async function listOrders(customer: string) {
  return ddb.send(new QueryCommand({ TableName: "orders", KeyConditionExpression: "c = :c" }));
}

export async function exportCsv(bucket: string, key: string) {
  await s3.putObject({ Bucket: bucket, Key: key, Body: "id\n" });
  // S3 Select is not served by the emulator at all (no handler)
  return s3.selectObjectContent({ Bucket: bucket, Key: key } as never);
}

export async function reviewAuthorizers(restApiId: string) {
  return gateway.getAuthorizers({ restApiId });
}
