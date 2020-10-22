export const presignUpload = async ({ id, fileName }) => {
  return {
    presigned: {
      url: "https://s3.bucket.com/launchpad",
      fields: {
        key: fileName,
        bucket: "s3.bucket.com",
        "X-Amz-Algorithm": "algo",
        "X-Amz-Credential": "AWS4-HMAC-SHA256",
        "X-Amz-Date": "20200530T020436Z",
        Policy: "long-string",
        "X-Amz-Signature": "signature",
      },
    },
    id,
  };
};
