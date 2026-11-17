// CommonJS usage: destructured require and a dynamically named method (cannot be resolved).
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { S3 } = require("@aws-sdk/client-s3");

const lambda = new LambdaClient({});
const s3 = new S3({});

module.exports.invoke = (name) => lambda.send(new InvokeCommand({ FunctionName: name }));
module.exports.dynamic = (method) => s3[method]({ Bucket: "b" });
