export const presignUpload = async ({ id, filePath }) => {
  return {
    presigned: {
      url: "https://s3.bucket.com/launchpad",
      fields: {
        key: filePath,
        bucket: "s3.bucket.com",
        "X-Amz-Algorithm": "algo",
        "X-Amz-Credential": "AWS4-HMAC-SHA256",
        "X-Amz-Date": "20200530T020436Z",
        Policy: "long-string",
        "X-Amz-Signature": "signature",
      },
    },
    isDuplicate: false,
    id,
    filePath,
  };
};

// BUG-032: default to "object exists" so tests exercising the duplicate
// short-circuit pass unchanged; individual tests override with
// `rawObjectExists.mockResolvedValue(false)` (or mockRejectedValue) to
// exercise the re-upload path.
export const rawObjectExists = jest.fn(async () => true);
