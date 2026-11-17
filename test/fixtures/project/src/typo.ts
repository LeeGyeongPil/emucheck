import { S3 } from "@aws-sdk/client-s3";

const s3 = new S3({});

export async function respond() {
  await s3.writeGetObjectResponse({ RequestRoute: "r", RequestToken: "t" } as any);
  await s3.putObjekt({ Bucket: "b", Key: "k" } as any);
}
